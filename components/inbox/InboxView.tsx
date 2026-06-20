// components/inbox/InboxView.tsx — the notifications inbox.
//
// Renders the operator's actionable items in four sections (Needs approval /
// Overdue diligence / IC-ready / Open risks). Each item is a row that deep-links
// to where the work gets done — the war-room session for an approval, the deal
// war-room for diligence, IC-readiness, and risks. Empty sections are hidden; a
// fully empty inbox shows a clean "all caught up" state. Dark/gold theme.
import Link from "next/link";
import type { Inbox, InboxItem, InboxTone } from "@/lib/inbox";
import { inboxTotal } from "@/lib/inbox";

// Tone → left-accent + pill classes. Approvals are gold (the operator's
// decision), overdue is red (past due), IC-ready is emerald (a win to act on),
// open risks are amber.
const ACCENT: Record<InboxTone, string> = {
  approval: "border-l-gold-500/70",
  overdue: "border-l-red-500/70",
  ready: "border-l-emerald-500/70",
  risk: "border-l-amber-500/70",
};

const PILL: Record<InboxTone, string> = {
  approval: "border-gold-500/40 bg-gold-500/10 text-gold-300",
  overdue: "border-red-500/40 bg-red-500/10 text-red-300",
  ready: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  risk: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

const PILL_LABEL: Record<InboxTone, string> = {
  approval: "Approve",
  overdue: "Overdue",
  ready: "IC-ready",
  risk: "Risk",
};

function Row({ item }: { item: InboxItem }) {
  return (
    <Link
      href={item.href}
      className={`group flex items-start gap-3 rounded-xl border border-line border-l-2 ${ACCENT[item.tone]} bg-surface-1 p-4 transition hover:border-gold-500/40 hover:bg-surface-2`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-fg-primary">{item.title}</span>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${PILL[item.tone]}`}
          >
            {PILL_LABEL[item.tone]}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-snug text-fg-secondary">{item.subtitle}</p>
      </div>
      <span
        className="mt-0.5 shrink-0 font-mono text-[11px] text-fg-muted transition group-hover:text-gold-300"
        aria-hidden
      >
        →
      </span>
    </Link>
  );
}

function Section({ title, items }: { title: string; items: InboxItem[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
        {title}
        <span className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] tracking-normal text-fg-secondary">
          {items.length}
        </span>
      </h2>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <Row key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

export function InboxView({ inbox }: { inbox: Inbox }) {
  if (inboxTotal(inbox) === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-surface-1 p-10 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
          ✓
        </div>
        <p className="mt-3 text-sm font-medium text-fg-primary">You&rsquo;re all caught up</p>
        <p className="mt-1 text-xs text-fg-secondary">
          No pending approvals, overdue diligence, IC-ready deals, or open critical risks right now.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Section title="Needs approval" items={inbox.needsApproval} />
      <Section title="Overdue diligence" items={inbox.overdueDiligence} />
      <Section title="IC-ready" items={inbox.icReady} />
      <Section title="Open risks" items={inbox.openRisks} />
    </div>
  );
}
