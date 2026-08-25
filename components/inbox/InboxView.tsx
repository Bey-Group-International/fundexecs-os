"use client";

// components/inbox/InboxView.tsx — the notifications inbox ("Needs you" lane).
//
// Renders the operator's actionable items in four sections (Needs approval /
// Overdue diligence / IC-ready / Open risks).
//
// Approvals are decided *here*. An approval row carries its pending approval id
// and the agent's own detail + output excerpt, so the operator can read what
// they're approving and then approve / reject / send it back without ever
// leaving the inbox — no navigation, no round-trip to open the detail. The deep
// link survives as an escape hatch for the full workflow, not as the only way to
// act. High-sensitivity work (outward-facing or capital-moving) takes an
// explicit second confirm before it clears.
//
// The other three sections are not approvals — they're work that genuinely lives
// on the deal war-room — so they stay deep-link rows.
import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Inbox, InboxItem, InboxTone } from "@/lib/inbox";
import { relativeTime } from "@/components/mobile/format";
import {
  dismissApprovalTask,
  dismissAllApprovalTasks,
  decideInboxApproval,
  type InboxApprovalDecision,
} from "@/app/(app)/inbox/actions";

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

// Risk pill on an approval row — mirrors the mobile flow's vocabulary so the
// same item reads the same way on either surface.
const RISK_PILL: Record<string, { label: string; cls: string }> = {
  high: { label: "High-sensitivity", cls: "border-status-danger/45 bg-status-danger/10 text-status-danger" },
  medium: { label: "Review", cls: "border-gold-500/40 bg-gold-500/10 text-gold-300" },
  low: { label: "Routine", cls: "border-status-success/40 bg-status-success/10 text-status-success" },
};

const DECIDED_LABEL: Record<InboxApprovalDecision, string> = {
  approved: "Approved",
  rejected: "Rejected",
  regenerate: "Sent back for revision",
};

function CheckIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 6.5" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The approval row — read it, decide it, all in place.
// ---------------------------------------------------------------------------
function ApprovalRow({
  item,
  onDecided,
  onDismiss,
}: {
  item: InboxItem;
  onDecided: (id: string, decision: InboxApprovalDecision) => void;
  onDismiss?: (id: string) => void;
}) {
  const approval = item.approval;
  // Detail expands in place. The content is already on the client, so this is a
  // pure show/hide — the panel is populated the instant it opens.
  const [open, setOpen] = useState(false);
  // "confirm" gates a high-sensitivity approve; "revise" captures the note that
  // goes back to the agent. Both render inline, replacing the action bar.
  const [mode, setMode] = useState<"idle" | "confirm" | "revise">("idle");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deciding, startDecide] = useTransition();

  const decide = useCallback(
    (decision: InboxApprovalDecision, noteText?: string) => {
      if (!approval) return;
      setError(null);
      setMode("idle");
      startDecide(async () => {
        const r = await decideInboxApproval(approval.approvalId, decision, noteText);
        if (r.ok) onDecided(item.id, decision);
        else setError(r.error ?? "Couldn't record that decision. Try again.");
      });
    },
    [approval, item.id, onDecided],
  );

  // No pending approval record to act on — the task is waiting on the operator
  // but there's nothing for the engine to decide. Fall back to the deep link
  // plus dismiss rather than offering a button that can't work.
  if (!approval) {
    return <LinkRow item={item} onDismiss={onDismiss} />;
  }

  const risk = RISK_PILL[approval.risk] ?? RISK_PILL.medium;
  const requested = relativeTime(approval.requestedAt);
  const highRisk = approval.risk === "high";

  return (
    <div
      className={`group relative flex flex-col rounded-xl border border-line border-l-2 ${ACCENT[item.tone]} bg-surface-1 transition hover:border-gold-500/40`}
    >
      {/* Header — clicking anywhere on it opens the detail in place. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 rounded-t-xl p-4 text-left transition hover:bg-surface-2"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-fg-primary">{item.title}</span>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${risk.cls}`}>
              {risk.label}
            </span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-snug text-fg-secondary">
            {approval.agentColor ? (
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: approval.agentColor }}
              />
            ) : null}
            <span>{approval.agentLabel ?? "An executive"} raised this</span>
            {approval.hubLabel ? <span className="text-fg-muted">· {approval.hubLabel}</span> : null}
            {requested ? <span className="text-fg-muted">· {requested}</span> : null}
          </p>
        </div>
        <span
          className="mt-0.5 shrink-0 font-mono text-[11px] text-fg-muted transition group-hover:text-gold-300"
          aria-hidden
        >
          {open ? "▾" : "▸"}
        </span>
      </button>

      {/* Detail — the agent's own words and what it produced. */}
      {open ? (
        <div className="mx-4 mb-3 rounded-lg border border-line/70 bg-surface-0/40 p-3">
          {approval.detail ? (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-fg-secondary">{approval.detail}</p>
          ) : (
            <p className="text-xs text-fg-muted">
              {approval.agentLabel ?? "The executive"} didn&rsquo;t attach a description to this request.
            </p>
          )}
          {approval.preview ? (
            <div className="mt-3 rounded-lg border border-line/60 bg-surface-1/70 p-3">
              <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                What {approval.agentLabel ?? "the executive"} produced
              </p>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-fg-primary">{approval.preview}</p>
            </div>
          ) : null}
          <Link
            href={item.href}
            className="mt-3 inline-flex items-center gap-1 text-[11px] text-fg-muted transition hover:text-gold-300"
          >
            Open the full workflow
            <span aria-hidden>↗</span>
          </Link>
        </div>
      ) : null}

      {/* Decision — always in reach, no expansion required for a routine call. */}
      <div className="border-t border-line/60 px-4 py-2.5">
        {mode === "confirm" ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-xs text-fg-secondary">
              This reaches outside the firm or moves capital. Approve and run it?
            </p>
            <button
              type="button"
              onClick={() => decide("approved")}
              className="rounded-md border border-status-danger/50 bg-status-danger/10 px-3 py-1 text-xs font-medium text-status-danger transition hover:bg-status-danger/20"
            >
              Yes, approve &amp; run
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              className="rounded-md px-2 py-1 text-xs text-fg-muted transition hover:text-fg-primary"
            >
              Cancel
            </button>
          </div>
        ) : mode === "revise" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              decide("regenerate", note.trim() || undefined);
            }}
          >
            <label className="sr-only" htmlFor={`revise-${item.id}`}>
              What should change before this comes back for approval?
            </label>
            <textarea
              id={`revise-${item.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              autoFocus
              placeholder="What should change? e.g. Soften the tone and add the Q2 numbers."
              className="w-full resize-none rounded-lg border border-line bg-surface-0/70 p-2.5 text-xs text-fg-primary placeholder:text-fg-muted focus:border-gold-500/50 focus:outline-none focus:ring-2 focus:ring-gold-400/25"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="submit"
                className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20"
              >
                Send back
              </button>
              <button
                type="button"
                onClick={() => setMode("idle")}
                className="rounded-md px-2 py-1 text-xs text-fg-muted transition hover:text-fg-primary"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={deciding}
              onClick={() => (highRisk ? setMode("confirm") : decide("approved"))}
              className="inline-flex items-center gap-1.5 rounded-md border border-status-success/45 bg-status-success/10 px-3 py-1 text-xs font-medium text-status-success transition hover:bg-status-success/20 disabled:opacity-50"
            >
              <CheckIcon />
              {deciding ? "Working…" : "Approve"}
            </button>
            <button
              type="button"
              disabled={deciding}
              onClick={() => decide("rejected")}
              className="inline-flex items-center gap-1.5 rounded-md border border-status-danger/40 bg-status-danger/[0.06] px-3 py-1 text-xs font-medium text-status-danger transition hover:bg-status-danger/15 disabled:opacity-50"
            >
              <CrossIcon />
              Reject
            </button>
            <button
              type="button"
              disabled={deciding}
              onClick={() => {
                setNote("");
                setMode("revise");
              }}
              className="rounded-md border border-line px-3 py-1 text-xs text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary disabled:opacity-50"
            >
              Request revision
            </button>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="ml-auto text-[11px] text-fg-muted transition hover:text-fg-primary"
            >
              {open ? "Hide details" : "Details"}
            </button>
          </div>
        )}
        {error ? <p className="mt-2 text-xs text-status-danger">{error}</p> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The deep-link row — overdue diligence, IC-ready deals, open risks. These are
// not decisions; they're work that lives on the deal war-room.
// ---------------------------------------------------------------------------
function LinkRow({
  item,
  onDismiss,
}: {
  item: InboxItem;
  onDismiss?: (id: string) => void;
}) {
  const [dismissing, startDismiss] = useTransition();
  const [dismissError, setDismissError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const isApproval = item.tone === "approval";

  function handleDismissClick() {
    setDismissError(false);
    setConfirming(true);
  }

  function handleConfirm() {
    setConfirming(false);
    startDismiss(async () => {
      const r = await dismissApprovalTask(taskIdFromItemId(item.id));
      if (r.ok) onDismiss?.(item.id);
      else setDismissError(true);
    });
  }

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
              <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${PILL[item.tone]}`}>
                {PILL_LABEL[item.tone]}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-snug text-fg-secondary">{item.subtitle}</p>
          </div>
          <span className="mt-0.5 shrink-0 font-mono text-[11px] text-fg-muted transition group-hover:text-gold-300" aria-hidden>→</span>
        </Link>
        {isApproval && onDismiss ? (
          confirming ? (
            <div className="flex shrink-0 items-center gap-1 border-l border-line px-3">
              <button
                type="button"
                onClick={handleConfirm}
                className="rounded px-2 py-1 text-xs text-status-danger transition hover:bg-status-danger/10"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded px-2 py-1 text-xs text-fg-muted transition hover:text-fg-primary"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={dismissing}
              onClick={handleDismissClick}
              className="shrink-0 self-stretch border-l border-line px-3 text-xs text-fg-muted transition hover:text-status-danger disabled:opacity-50"
              aria-label={`Dismiss ${item.title}`}
            >
              {dismissing ? "…" : "Dismiss"}
            </button>
          )
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
  onDecided,
  onDismiss,
  onDismissAll,
  dismissingAll,
  dismissAllError,
  confirmingAll,
  onConfirmingAllChange,
}: {
  title: string;
  items: InboxItem[];
  onDecided?: (id: string, decision: InboxApprovalDecision) => void;
  onDismiss?: (id: string) => void;
  onDismissAll?: () => void;
  dismissingAll?: boolean;
  dismissAllError?: boolean;
  confirmingAll?: boolean;
  onConfirmingAllChange?: (v: boolean) => void;
}) {
  if (items.length === 0) return null;
  const isApproval = items[0]?.tone === "approval";
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
        {title}
        <span className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] tracking-normal text-fg-secondary">
          {items.length}
        </span>
        {isApproval && onDismissAll && items.length > 1 ? (
          confirmingAll ? (
            <div className="ml-auto flex items-center gap-1">
              <span className="text-[11px] normal-case tracking-normal text-fg-secondary">Cancel all tasks?</span>
              <button
                type="button"
                onClick={onDismissAll}
                className="rounded-md border border-status-danger/40 px-2 py-0.5 text-[11px] normal-case tracking-normal text-status-danger transition hover:bg-status-danger/10"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => onConfirmingAllChange?.(false)}
                className="rounded-md border border-line px-2 py-0.5 text-[11px] normal-case tracking-normal text-fg-muted transition hover:text-fg-primary"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={dismissingAll}
              onClick={() => onConfirmingAllChange?.(true)}
              className="ml-auto rounded-md border border-line px-2 py-0.5 text-[11px] normal-case tracking-normal text-fg-muted transition hover:border-status-danger/50 hover:text-status-danger disabled:opacity-50"
            >
              {dismissingAll ? "Dismissing…" : "Dismiss all"}
            </button>
          )
        ) : null}
      </h2>
      {dismissAllError ? (
        <p className="mb-2 text-xs text-status-danger">Failed to dismiss all. Try again.</p>
      ) : null}
      <div className="flex flex-col gap-2">
        {items.map((item) =>
          isApproval && onDecided ? (
            <ApprovalRow key={item.id} item={item} onDecided={onDecided} onDismiss={onDismiss} />
          ) : (
            <LinkRow key={item.id} item={item} onDismiss={onDismiss} />
          ),
        )}
      </div>
    </section>
  );
}

export function InboxView({ inbox }: { inbox: Inbox }) {
  const router = useRouter();
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [dismissingAll, startDismissAll] = useTransition();
  const [dismissAllError, setDismissAllError] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);
  // Screen-reader announcement for each decision and the resulting queue depth.
  const [announce, setAnnounce] = useState("");

  const needsApproval = inbox.needsApproval.filter((i) => !cleared.has(i.id));

  const visible = {
    needsApproval,
    overdueDiligence: inbox.overdueDiligence,
    icReady: inbox.icReady,
    openRisks: inbox.openRisks,
  };
  const total = needsApproval.length + inbox.overdueDiligence.length + inbox.icReady.length + inbox.openRisks.length;

  // A decided approval leaves the list immediately — the server has already
  // recorded it, so the refresh below only reconciles what else changed.
  const handleDecided = useCallback(
    (id: string, decision: InboxApprovalDecision) => {
      setCleared((prev) => new Set([...prev, id]));
      const left = needsApproval.length - 1;
      setAnnounce(
        `${DECIDED_LABEL[decision]}. ${left > 0 ? `${left} approval${left === 1 ? "" : "s"} left.` : "No approvals left."}`,
      );
      router.refresh();
    },
    [needsApproval.length, router],
  );

  function handleDismiss(id: string) {
    setCleared((prev) => new Set([...prev, id]));
    router.refresh();
  }

  function handleDismissAll() {
    setConfirmingAll(false);
    setDismissAllError(false);
    startDismissAll(async () => {
      const r = await dismissAllApprovalTasks(needsApproval.map((i) => taskIdFromItemId(i.id)));
      if (r.ok) {
        setCleared((prev) => new Set([...prev, ...needsApproval.map((i) => i.id)]));
        setAnnounce("Dismissed every pending approval.");
        router.refresh();
      } else {
        setDismissAllError(true);
      }
    });
  }

  if (total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-surface-1 p-10 text-center">
        <span className="sr-only" role="status" aria-live="polite">
          {announce}
        </span>
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
      <span className="sr-only" role="status" aria-live="polite">
        {announce}
      </span>
      <Section
        title="Needs approval"
        items={visible.needsApproval}
        onDecided={handleDecided}
        onDismiss={handleDismiss}
        onDismissAll={handleDismissAll}
        dismissingAll={dismissingAll}
        dismissAllError={dismissAllError}
        confirmingAll={confirmingAll}
        onConfirmingAllChange={setConfirmingAll}
      />
      <Section title="Overdue diligence" items={visible.overdueDiligence} />
      <Section title="IC-ready" items={visible.icReady} />
      <Section title="Open risks" items={visible.openRisks} />
    </div>
  );
}
