"use client";

// components/inbox/InboxView.tsx — the notifications inbox.
//
// Renders the operator's actionable items in four sections (Needs approval /
// Overdue diligence / IC-ready / Open risks). Approval items can be dismissed
// (cancelled) individually or in bulk. Other item types are deep-link only.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Inbox, InboxItem, InboxTone } from "@/lib/inbox";
import { dismissApprovalTask, dismissAllApprovalTasks } from "@/app/(app)/inbox/actions";

// InboxItem.id is prefixed ("approval:<uuid>") — extract the raw task UUID.
function taskIdFromItemId(itemId: string): string {
  return itemId.includes(":") ? itemId.split(":")[1] : itemId;
}

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

function Row({
  item,
  onDismiss,
}: {
  item: InboxItem;
  onDismiss?: (id: string) => void;
}) {
  const [dismissing, startDismiss] = useTransition();
  const [dismissError, setDismissError] = useState(false);
  const isApproval = item.tone === "approval";

  return (
    <div className={`group relative flex flex-col rounded-xl border border-line border-l-2 ${ACCENT[item.tone]} bg-surface-1 transition hover:border-gold-500/40 hover:bg-surface-2`}>
      <div className="flex items-stretch">
        <Link
          href={item.href}
          className="flex min-w-0 flex-1 items-start gap-3 p-4"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium text-fg-primary">{item.title}</span>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${PILL[item.tone]}`}>
                {PILL_LABEL[item.tone]}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-snug text-fg-secondary">{item.subtitle}</p>
          </div>
          <span className="mt-0.5 shrink-0 font-mono text-[11px] text-fg-muted transition group-hover:text-gold-300" aria-hidden>→</span>
        </Link>
        {isApproval && onDismiss ? (
          <button
            type="button"
            disabled={dismissing}
            onClick={() => {
              setDismissError(false);
              if (!confirm("Dismiss this approval request? The associated task will be cancelled.")) return;
              startDismiss(async () => {
                const r = await dismissApprovalTask(taskIdFromItemId(item.id));
                if (r.ok) onDismiss(item.id);
                else setDismissError(true);
              });
            }}
            className="shrink-0 self-stretch border-l border-line px-3 text-xs text-fg-muted transition hover:text-status-danger disabled:opacity-50"
            aria-label={`Dismiss ${item.title}`}
          >
            {dismissing ? "…" : "Dismiss"}
          </button>
        ) : null}
      </div>
      {dismissError ? (
        <p className="px-4 pb-2 text-xs text-status-danger">Failed to dismiss. Try again.</p>
      ) : null}
    </div>
  );
}

function Section({
  title,
  items,
  onDismiss,
  onDismissAll,
  dismissingAll,
  dismissAllError,
}: {
  title: string;
  items: InboxItem[];
  onDismiss?: (id: string) => void;
  onDismissAll?: () => void;
  dismissingAll?: boolean;
  dismissAllError?: boolean;
}) {
  if (items.length === 0) return null;
  const isApproval = items[0]?.tone === "approval";
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
        {title}
        <span className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] tracking-normal text-fg-secondary">
          {items.length}
        </span>
        {isApproval && onDismissAll && items.length > 1 ? (
          <button
            type="button"
            disabled={dismissingAll}
            onClick={onDismissAll}
            className="ml-auto rounded-md border border-line px-2 py-0.5 text-[10px] normal-case tracking-normal text-fg-muted transition hover:border-status-danger/50 hover:text-status-danger disabled:opacity-50"
          >
            {dismissingAll ? "Dismissing…" : "Dismiss all"}
          </button>
        ) : null}
      </h2>
      {dismissAllError ? (
        <p className="mb-2 text-xs text-status-danger">Failed to dismiss all. Try again.</p>
      ) : null}
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <Row key={item.id} item={item} onDismiss={onDismiss} />
        ))}
      </div>
    </section>
  );
}

export function InboxView({ inbox }: { inbox: Inbox }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [dismissingAll, startDismissAll] = useTransition();
  const [dismissAllError, setDismissAllError] = useState(false);

  const needsApproval = inbox.needsApproval.filter((i) => !dismissed.has(i.id));

  const visible = {
    needsApproval,
    overdueDiligence: inbox.overdueDiligence,
    icReady: inbox.icReady,
    openRisks: inbox.openRisks,
  };
  const total = needsApproval.length + inbox.overdueDiligence.length + inbox.icReady.length + inbox.openRisks.length;

  function handleDismiss(id: string) {
    setDismissed((prev) => new Set([...prev, id]));
    router.refresh();
  }

  function handleDismissAll() {
    if (!confirm(`Dismiss all ${needsApproval.length} approval request${needsApproval.length === 1 ? "" : "s"}? The associated tasks will be cancelled.`)) return;
    setDismissAllError(false);
    startDismissAll(async () => {
      const r = await dismissAllApprovalTasks(needsApproval.map((i) => taskIdFromItemId(i.id)));
      if (r.ok) {
        setDismissed((prev) => new Set([...prev, ...needsApproval.map((i) => i.id)]));
        router.refresh();
      } else {
        setDismissAllError(true);
      }
    });
  }

  if (total === 0) {
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
      <Section
        title="Needs approval"
        items={visible.needsApproval}
        onDismiss={handleDismiss}
        onDismissAll={handleDismissAll}
        dismissingAll={dismissingAll}
        dismissAllError={dismissAllError}
      />
      <Section title="Overdue diligence" items={visible.overdueDiligence} />
      <Section title="IC-ready" items={visible.icReady} />
      <Section title="Open risks" items={visible.openRisks} />
    </div>
  );
}
