"use server";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

type EnvelopeStatus = "draft" | "sent" | "partially_signed" | "completed" | "voided";

interface Envelope {
  id: string;
  title: string;
  status: EnvelopeStatus;
  created_at: string;
  recipient_count: number;
}

const STATUS_LABELS: Record<EnvelopeStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_signed: "Partially Signed",
  completed: "Completed",
  voided: "Voided",
};

function StatusBadge({ status }: { status: EnvelopeStatus }) {
  const base =
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider border";
  const variants: Record<EnvelopeStatus, { dot: string; classes: string }> = {
    draft: { dot: "bg-fg-muted", classes: "border-line bg-surface-2 text-fg-muted" },
    sent: {
      dot: "bg-status-info",
      classes: "border-[color:var(--status-info)]/30 bg-[color:var(--status-info)]/10 text-[color:var(--status-info)]",
    },
    partially_signed: {
      dot: "bg-status-warning",
      classes: "border-[color:var(--status-warning)]/30 bg-[color:var(--status-warning)]/10 text-[color:var(--status-warning)]",
    },
    completed: {
      dot: "bg-status-success",
      classes: "border-[color:var(--status-success)]/30 bg-[color:var(--status-success)]/10 text-[color:var(--status-success)]",
    },
    voided: {
      dot: "bg-status-danger",
      classes: "border-[color:var(--status-danger)]/30 bg-[color:var(--status-danger)]/10 text-[color:var(--status-danger)]",
    },
  };
  const { dot, classes } = variants[status] ?? variants.draft;
  return (
    <span className={`${base} ${classes}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface-1 px-8 py-20 text-center">
      <svg aria-hidden className="mb-4 h-12 w-12 text-fg-muted" fill="none" stroke="currentColor" strokeWidth={1.25} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <h2 className="font-display text-lg font-semibold text-fg-primary">No envelopes yet</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-fg-muted">
        Create your first envelope to send documents for signature to LPs, co-investors, or service providers.
      </p>
      <Link
        href="/envelopes/new"
        className="mt-6 rounded-lg bg-gold-500 px-4 py-2 text-xs font-medium text-surface-0 shadow-[0_10px_24px_-14px_rgb(var(--fx-accent-rgb)/0.85)] transition hover:bg-gold-400"
      >
        New Envelope
      </Link>
    </div>
  );
}

export async function SigningModule() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");

  const supabase = createServerClient();
  let envelopes: Envelope[] = [];
  try {
    const { data, error } = await (supabase as any)
      .from("envelopes")
      .select("id, title, status, created_at, recipient_count")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!error && data) envelopes = data as Envelope[];
  } catch {
    // Table not yet migrated — render empty state.
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-fg-secondary">
            Send, track, and collect signatures on subscription docs, side letters, NDAs, and any other fund documents.
          </p>
        </div>
        <Link
          href="/envelopes/new"
          className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-medium text-surface-0 shadow-[0_10px_24px_-14px_rgb(var(--fx-accent-rgb)/0.85)] transition hover:bg-gold-400"
        >
          <svg aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Envelope
        </Link>
      </div>

      {envelopes.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="fx-card overflow-hidden">
          <div className="hidden grid-cols-[1fr_160px_140px_80px] items-center gap-4 border-b border-line px-5 py-3 sm:grid">
            <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Document</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Status</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Created</span>
            <span className="text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted">Recipients</span>
          </div>
          <ul role="list" className="divide-y divide-line">
            {envelopes.map((env) => (
              <li key={env.id}>
                <Link
                  href={`/envelopes/${env.id}`}
                  className="group flex flex-col gap-3 px-5 py-4 transition hover:bg-surface-2 sm:grid sm:grid-cols-[1fr_160px_140px_80px] sm:items-center sm:gap-4"
                >
                  <span className="truncate text-sm font-medium text-fg-primary transition group-hover:text-gold-300">
                    {env.title || "Untitled Envelope"}
                  </span>
                  <span><StatusBadge status={env.status} /></span>
                  <span className="font-mono text-[11px] text-fg-muted">{formatDate(env.created_at)}</span>
                  <span className="text-left font-mono text-sm tabular-nums text-fg-secondary sm:text-right">
                    {env.recipient_count ?? 0}
                    <span className="ml-1 text-[10px] text-fg-muted">
                      {(env.recipient_count ?? 0) === 1 ? "signer" : "signers"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
