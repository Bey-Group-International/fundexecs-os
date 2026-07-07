"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { decideApprovalAction } from "@/app/(app)/approvals/actions";
import { MobileSheet } from "./MobileSheet";
import { ShieldIcon, SparkIcon, CloseIcon, EarnIcon } from "./icons";
import { haptic } from "./haptics";
import { relativeTime } from "./format";

export interface ApprovalItem {
  approvalId: string;
  title: string;
  description: string | null;
  preview: string | null;
  agentLabel: string;
  agentColor: string | null;
  risk: "high" | "medium" | "low";
  hubLabel: string | null;
  requestedAt: string | null;
}

const RISK: Record<string, { label: string; cls: string }> = {
  high: { label: "High-sensitivity", cls: "border-status-danger/45 text-status-danger" },
  medium: { label: "Review", cls: "border-gold-500/45 text-gold-400" },
  low: { label: "Routine", cls: "border-status-success/45 text-status-success" },
};

const THRESHOLD = 110;

function CheckIcon(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      <path d="m5 12.5 4.5 4.5L19 6.5" />
    </svg>
  );
}

// The mobile approvals decision flow: one approval at a time, swipe RIGHT to
// approve / LEFT to reject (buttons mirror it for accessibility). "Request
// revision" captures a note and sends it back to Earn. High-sensitivity items
// require an explicit confirm before approving — a swipe alone won't clear them.
// Optimistic: the decision is captured server-side while the UI advances, so
// clearing a stack feels instant even though execution runs async. Dedicated
// mobile surface; the desktop inbox is untouched.
export function MobileApprovalsFlow({ items }: { items: ApprovalItem[] }) {
  const [index, setIndex] = useState(0);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState<null | ApprovalItem>(null);
  const [reviseFor, setReviseFor] = useState<null | ApprovalItem>(null);
  const [note, setNote] = useState("");
  const [counts, setCounts] = useState({ approved: 0, rejected: 0, revised: 0 });

  const startX = useRef(0);
  const active = useRef(false);

  const current = items[index];
  const next = items[index + 1];
  const remaining = items.length - index;

  function advance(kind: "approved" | "rejected" | "revised") {
    setDx(0);
    setDragging(false);
    setCounts((c) => ({ ...c, [kind]: c[kind] + 1 }));
    setIndex((i) => i + 1);
  }

  function commit(decision: "approved" | "rejected" | "regenerate", item: ApprovalItem, noteText?: string) {
    haptic(decision === "rejected" ? "warn" : "success");
    // Fire-and-forget: approving kicks off (potentially long) execution on the
    // server; we never block the swipe on it.
    decideApprovalAction(item.approvalId, decision, noteText).catch(() => undefined);
    advance(decision === "rejected" ? "rejected" : decision === "regenerate" ? "revised" : "approved");
  }

  function onApprove(item: ApprovalItem) {
    if (item.risk === "high") {
      setDx(0);
      setConfirm(item);
      return;
    }
    commit("approved", item);
  }

  // ── Pointer drag (works for touch + mouse; Playwright can drive it) ──
  function onPointerDown(e: React.PointerEvent) {
    if (confirm || reviseFor) return;
    active.current = true;
    startX.current = e.clientX;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!active.current) return;
    setDx(e.clientX - startX.current);
  }
  function onPointerUp() {
    if (!active.current) return;
    active.current = false;
    setDragging(false);
    if (dx > THRESHOLD && current) onApprove(current);
    else if (dx < -THRESHOLD && current) commit("rejected", current);
    else setDx(0);
  }

  // ── Done state ──
  if (!current) {
    const total = counts.approved + counts.rejected + counts.revised;
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center justify-center px-6 pt-20 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-status-success/40 bg-status-success/10 text-status-success">
          <CheckIcon width={30} height={30} />
        </span>
        <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-fg-primary">
          {total > 0 ? "Cleared." : "Nothing to approve"}
        </h1>
        <p className="mt-2 text-[13.5px] text-fg-secondary">
          {total > 0
            ? `You decided ${total} ${total === 1 ? "item" : "items"} — ${counts.approved} approved, ${counts.rejected} rejected${counts.revised ? `, ${counts.revised} sent back` : ""}. Earn is running the approved work now.`
            : "No approvals are waiting on you. Earn will surface anything that needs a decision here."}
        </p>
        <div className="mt-6 flex gap-2.5">
          <Link href="/home" className="fx-tap rounded-xl border border-line bg-surface-1 px-5 py-2.5 text-[13px] font-semibold text-fg-secondary transition active:bg-surface-2">
            Back to home
          </Link>
          <Link href="/earn" className="fx-tap rounded-xl border border-gold-500/40 bg-gold-500/[0.08] px-5 py-2.5 text-[13px] font-semibold text-gold-300">
            Ask Earn ›
          </Link>
        </div>
      </div>
    );
  }

  const risk = RISK[current.risk];
  const approveHint = Math.max(0, Math.min(1, dx / THRESHOLD));
  const rejectHint = Math.max(0, Math.min(1, -dx / THRESHOLD));

  return (
    <div className="mx-auto max-w-lg select-none">
      {/* Header + progress */}
      <header className="pt-1">
        <div className="flex items-end justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">Approvals</p>
            <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-fg-primary">
              {remaining} to decide
            </h1>
          </div>
          <span className="font-mono text-[11px] text-fg-muted">
            {index + 1} / {items.length}
          </span>
        </div>
        <div className="mt-3 flex gap-1">
          {items.map((_, i) => (
            <span key={i} className={`h-1 flex-1 rounded-full ${i < index ? "bg-gold-500/70" : i === index ? "bg-gold-400" : "bg-surface-3"}`} />
          ))}
        </div>
      </header>

      {/* Card stack */}
      <div className="relative mt-5 h-[420px]">
        {/* Peeking next card */}
        {next && (
          <div className="absolute inset-x-2 top-2 h-full rounded-3xl border border-line/50 bg-surface-1/60" style={{ transform: "scale(0.96)" }} aria-hidden />
        )}

        {/* Current card */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            transform: `translateX(${dx}px) rotate(${dx * 0.03}deg)`,
            transition: dragging ? "none" : "transform 0.3s cubic-bezier(0.22,1,0.36,1)",
            touchAction: "pan-y",
          }}
          className="absolute inset-0 flex flex-col overflow-hidden rounded-3xl border border-line bg-surface-1 shadow-[0_20px_60px_-30px_rgb(0_0_0/0.7)]"
        >
          {/* Swipe intent overlays */}
          <span className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border-2 border-status-success px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-wider text-status-success" style={{ opacity: approveHint, transform: `rotate(-12deg)` }}>
            Approve
          </span>
          <span className="pointer-events-none absolute right-4 top-4 z-10 rounded-lg border-2 border-status-danger px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-wider text-status-danger" style={{ opacity: rejectHint, transform: `rotate(12deg)` }}>
            Reject
          </span>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[12px] text-fg-secondary">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: current.agentColor ?? "rgb(var(--fx-accent-400))" }} aria-hidden />
                {current.agentLabel}
                {current.hubLabel ? <span className="text-fg-muted">· {current.hubLabel}</span> : null}
              </span>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide ${risk.cls}`}>
                {risk.label}
              </span>
            </div>

            <h2 className="mt-3 font-display text-[19px] font-semibold leading-snug text-fg-primary">{current.title}</h2>
            {current.description && <p className="mt-2 text-[13.5px] leading-snug text-fg-secondary">{current.description}</p>}

            {current.preview && (
              <div className="mt-3 rounded-2xl border border-line/70 bg-surface-0/60 p-3">
                <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  <EarnIcon width={12} height={12} className="text-gold-400" /> What Earn produced
                </p>
                <p className="line-clamp-6 whitespace-pre-wrap text-[12.5px] leading-snug text-fg-primary">{current.preview}</p>
              </div>
            )}

            {relativeTime(current.requestedAt) && (
              <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Requested {relativeTime(current.requestedAt)}</p>
            )}
          </div>
        </div>
      </div>

      {/* Decision buttons */}
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
        <button
          type="button"
          onClick={() => current && commit("rejected", current)}
          className="fx-tap flex items-center justify-center gap-1.5 rounded-2xl border border-status-danger/40 bg-status-danger/[0.06] py-3 text-[13.5px] font-semibold text-status-danger transition active:scale-[0.98]"
        >
          <CloseIcon width={16} height={16} /> Reject
        </button>
        <button
          type="button"
          onClick={() => {
            setNote("");
            setReviseFor(current);
          }}
          aria-label="Request revision"
          className="fx-tap flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface-1 text-fg-secondary transition active:bg-surface-2"
        >
          <SparkIcon width={18} height={18} />
        </button>
        <button
          type="button"
          onClick={() => current && onApprove(current)}
          className="fx-tap flex items-center justify-center gap-1.5 rounded-2xl border border-status-success/45 bg-status-success/[0.08] py-3 text-[13.5px] font-semibold text-status-success transition active:scale-[0.98]"
        >
          <CheckIcon width={16} height={16} /> Approve
        </button>
      </div>
      <p className="mt-2.5 text-center font-mono text-[9px] uppercase tracking-wider text-fg-muted">
        Swipe → approve · ← reject · ✦ request revision
      </p>

      {/* High-sensitivity confirm */}
      <MobileSheet
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Confirm approval"
        subtitle="This is a high-sensitivity action — it reaches outside the firm or moves capital."
        labelledBy="fx-confirm-title"
      >
        {confirm && (
          <div className="px-1 pb-2">
            <div className="rounded-2xl border border-status-danger/30 bg-status-danger/[0.05] p-3.5">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-fg-primary">
                <ShieldIcon width={16} height={16} className="text-status-danger" />
                {confirm.title}
              </p>
              {confirm.description && <p className="mt-1.5 text-[12.5px] text-fg-secondary">{confirm.description}</p>}
            </div>
            <button
              type="button"
              onClick={() => {
                const item = confirm;
                setConfirm(null);
                commit("approved", item);
              }}
              className="fx-tap mt-4 w-full rounded-2xl bg-gradient-to-br from-gold-300 to-gold-500 py-3 text-[14px] font-semibold text-surface-0 transition active:scale-[0.99]"
            >
              Yes, approve &amp; execute
            </button>
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className="fx-tap mt-2 w-full rounded-2xl border border-line py-3 text-[13.5px] font-medium text-fg-secondary transition active:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        )}
      </MobileSheet>

      {/* Request revision — capture a note back to Earn */}
      <MobileSheet
        open={!!reviseFor}
        onClose={() => setReviseFor(null)}
        title="Request a revision"
        subtitle="Tell Earn what to change — it'll rework and re-submit for approval."
        labelledBy="fx-revise-title"
      >
        {reviseFor && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const item = reviseFor;
              const text = note.trim();
              setReviseFor(null);
              commit("regenerate", item, text || undefined);
            }}
            className="px-1 pb-2"
          >
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              autoFocus
              placeholder="e.g. Soften the tone and add the Q2 numbers before sending."
              className="w-full resize-none rounded-2xl border border-line bg-surface-0/70 p-3.5 text-[14px] text-fg-primary placeholder:text-fg-muted focus:border-gold-500/50 focus:outline-none focus:ring-2 focus:ring-gold-400/25"
            />
            <button
              type="submit"
              className="fx-tap mt-3 w-full rounded-2xl bg-gradient-to-br from-gold-300 to-gold-500 py-3 text-[14px] font-semibold text-surface-0 transition active:scale-[0.99]"
            >
              Send back to Earn
            </button>
          </form>
        )}
      </MobileSheet>
    </div>
  );
}
