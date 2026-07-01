"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EnvelopeRow, RecipientRow, EnvelopeStatus, RecipientStatus } from "@/lib/signing";
import type { EnvelopeEvent } from "./page";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...opts,
  }).format(new Date(iso));
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// StatusBadge — envelope
// ---------------------------------------------------------------------------

const ENVELOPE_STATUS_LABELS: Record<EnvelopeStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_signed: "Partially Signed",
  completed: "Completed",
  voided: "Voided",
};

const ENVELOPE_STATUS_STYLES: Record<
  EnvelopeStatus,
  { dot: string; badge: string }
> = {
  draft: {
    dot: "bg-fg-muted",
    badge: "border-line bg-surface-2 text-fg-muted",
  },
  sent: {
    dot: "bg-[color:var(--status-info)]",
    badge:
      "border-[color:var(--status-info)]/30 bg-[color:var(--status-info)]/10 text-[color:var(--status-info)]",
  },
  partially_signed: {
    dot: "bg-[color:var(--status-warning)]",
    badge:
      "border-[color:var(--status-warning)]/30 bg-[color:var(--status-warning)]/10 text-[color:var(--status-warning)]",
  },
  completed: {
    dot: "bg-[color:var(--status-success)]",
    badge:
      "border-[color:var(--status-success)]/30 bg-[color:var(--status-success)]/10 text-[color:var(--status-success)]",
  },
  voided: {
    dot: "bg-[color:var(--status-danger)]",
    badge:
      "border-[color:var(--status-danger)]/30 bg-[color:var(--status-danger)]/10 text-[color:var(--status-danger)]",
  },
};

function EnvelopeStatusBadge({ status }: { status: EnvelopeStatus }) {
  const { dot, badge } = ENVELOPE_STATUS_STYLES[status] ?? ENVELOPE_STATUS_STYLES.draft;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {ENVELOPE_STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// RecipientStatusBadge
// ---------------------------------------------------------------------------

const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  pending: "Pending",
  viewed: "Viewed",
  signed: "Signed",
  declined: "Declined",
};

const RECIPIENT_STATUS_STYLES: Record<RecipientStatus, string> = {
  pending: "border-line bg-surface-2 text-fg-muted",
  viewed:
    "border-[color:var(--status-info)]/30 bg-[color:var(--status-info)]/10 text-[color:var(--status-info)]",
  signed:
    "border-[color:var(--status-success)]/30 bg-[color:var(--status-success)]/10 text-[color:var(--status-success)]",
  declined:
    "border-[color:var(--status-danger)]/30 bg-[color:var(--status-danger)]/10 text-[color:var(--status-danger)]",
};

function RecipientStatusBadge({ status }: { status: RecipientStatus }) {
  const cls = RECIPIENT_STATUS_STYLES[status] ?? RECIPIENT_STATUS_STYLES.pending;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cls}`}
    >
      {RECIPIENT_STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CopyButton — copy signing link for a recipient
// ---------------------------------------------------------------------------

function CopyButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const url = `${window.location.origin}/sign/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy signing link"
      title="Copy signing link"
      className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
    >
      {copied ? (
        <>
          {/* Checkmark */}
          <svg
            aria-hidden
            className="h-3 w-3 text-[color:var(--status-success)]"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 16 16"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.5 8.5l3.5 3.5 7-7"
            />
          </svg>
          Copied
        </>
      ) : (
        <>
          {/* Link icon */}
          <svg
            aria-hidden
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 16 16"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6.5 9.5a3.5 3.5 0 004.95.04l1.5-1.5a3.5 3.5 0 00-4.95-4.95l-.86.86"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.5 6.5a3.5 3.5 0 00-4.95-.04l-1.5 1.5a3.5 3.5 0 004.95 4.95l.86-.86"
            />
          </svg>
          Copy link
        </>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Event audit trail icon
// ---------------------------------------------------------------------------

const EVENT_ICON: Record<string, React.ReactNode> = {
  created: (
    <svg
      aria-hidden
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 16 16"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 2v12M2 8h12"
      />
    </svg>
  ),
  sent: (
    <svg
      aria-hidden
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 16 16"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2 8l12-6-6 12-1.5-4.5L2 8z"
      />
    </svg>
  ),
  viewed: (
    <svg
      aria-hidden
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 16 16"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"
      />
      <circle cx="8" cy="8" r="2" />
    </svg>
  ),
  signed: (
    <svg
      aria-hidden
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      viewBox="0 0 16 16"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.5 8.5l3.5 3.5 7-7"
      />
    </svg>
  ),
  completed: (
    <svg
      aria-hidden
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 16 16"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 8.5l2.5 2.5 5-5M8 1a7 7 0 110 14A7 7 0 018 1z"
      />
    </svg>
  ),
  voided: (
    <svg
      aria-hidden
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 16 16"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 4l8 8M12 4l-8 8"
      />
    </svg>
  ),
};

const EVENT_LABEL: Record<string, string> = {
  created: "Envelope created",
  sent: "Sent to recipients",
  viewed: "Document viewed",
  signed: "Document signed",
  completed: "All signatures collected",
  voided: "Envelope voided",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  envelope: EnvelopeRow;
  recipients: RecipientRow[];
  events: EnvelopeEvent[];
}

// ---------------------------------------------------------------------------
// EnvelopeDetail — root client component
// ---------------------------------------------------------------------------

export function EnvelopeDetail({ envelope, recipients, events }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const canSend = envelope.status === "draft";
  const canVoid = envelope.status !== "voided" && envelope.status !== "completed";

  // -------------------------------------------------------------------------
  // Send for signatures
  // -------------------------------------------------------------------------

  function handleSend() {
    setActionError(null);
    setActionSuccess(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/envelopes/${envelope.id}/send`, {
          method: "POST",
        });
        if (!res.ok) {
          let msg = `Request failed (${res.status}).`;
          try {
            const json = (await res.json()) as { error?: string };
            if (json.error) msg = json.error;
          } catch {
            // ignore
          }
          setActionError(msg);
          return;
        }
        setActionSuccess("Envelope sent. Recipients will receive signing links.");
        router.refresh();
      } catch {
        setActionError("An unexpected error occurred. Please try again.");
      }
    });
  }

  // -------------------------------------------------------------------------
  // Void envelope
  // -------------------------------------------------------------------------

  function handleVoid() {
    if (
      !window.confirm(
        "Are you sure you want to void this envelope? This cannot be undone."
      )
    )
      return;

    setActionError(null);
    setActionSuccess(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/envelopes/${envelope.id}/void`, {
          method: "POST",
        });
        if (!res.ok) {
          let msg = `Request failed (${res.status}).`;
          try {
            const json = (await res.json()) as { error?: string };
            if (json.error) msg = json.error;
          } catch {
            // ignore
          }
          setActionError(msg);
          return;
        }
        setActionSuccess("Envelope voided.");
        router.refresh();
      } catch {
        setActionError("An unexpected error occurred. Please try again.");
      }
    });
  }

  // -------------------------------------------------------------------------
  // Signer progress counts
  // -------------------------------------------------------------------------

  const signedCount = recipients.filter((r) => r.status === "signed").length;
  const totalCount = recipients.length;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-4xl space-y-6">

      {/* ------------------------------------------------------------------ */}
      {/* Breadcrumb + header card                                            */}
      {/* ------------------------------------------------------------------ */}
      <header className="fx-glass p-5 sm:p-6">
        <Link
          href="/envelopes"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400 hover:underline"
        >
          ← Documents &amp; Signatures
        </Link>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-primary sm:text-3xl">
                {envelope.title || "Untitled Envelope"}
              </h1>
              <EnvelopeStatusBadge status={envelope.status} />
            </div>

            <p className="mt-1.5 font-mono text-[11px] text-fg-muted">
              Created {formatDate(envelope.created_at)} &middot;{" "}
              {totalCount} {totalCount === 1 ? "recipient" : "recipients"}
              {envelope.status !== "draft" && totalCount > 0 && (
                <> &middot; {signedCount}/{totalCount} signed</>
              )}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canSend && (
              <button
                type="button"
                onClick={handleSend}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-medium text-surface-0 shadow-[0_10px_24px_-14px_rgb(var(--fx-accent-rgb)/0.85)] transition hover:bg-gold-400 hover:shadow-[0_12px_28px_-14px_rgb(var(--fx-accent-rgb)/0.95)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
              >
                {isPending ? (
                  "Sending…"
                ) : (
                  <>
                    {/* Send icon */}
                    <svg
                      aria-hidden
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 8l9-5 9 5v8l-9 5-9-5V8z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 3v14"
                      />
                    </svg>
                    Send for Signatures
                  </>
                )}
              </button>
            )}

            {canVoid && (
              <button
                type="button"
                onClick={handleVoid}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--status-danger)]/40 px-3 py-2 text-sm text-[color:var(--status-danger)] transition hover:bg-[color:var(--status-danger)]/10 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--status-danger)]"
              >
                {isPending ? "Voiding…" : "Void Envelope"}
              </button>
            )}
          </div>
        </div>

        {/* Feedback banners */}
        {actionSuccess && (
          <p
            role="status"
            className="mt-4 rounded-md border border-[color:var(--status-success)]/30 bg-[color:var(--status-success)]/10 px-3 py-2 text-sm text-[color:var(--status-success)]"
          >
            {actionSuccess}
          </p>
        )}
        {actionError && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-[color:var(--status-danger)]/30 bg-[color:var(--status-danger)]/10 px-3 py-2 text-sm text-[color:var(--status-danger)]"
          >
            {actionError}
          </p>
        )}
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Completion summary (status === completed)                           */}
      {/* ------------------------------------------------------------------ */}
      {envelope.status === "completed" && (
        <div className="fx-card p-5">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-gold-400">
            Completed
          </p>
          <p className="text-sm text-fg-primary">
            All {totalCount} {totalCount === 1 ? "recipient" : "recipients"} signed
            on{" "}
            <span className="font-medium">
              {formatDate(envelope.completed_at, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            . The envelope is fully executed.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {recipients
              .filter((r) => r.status === "signed")
              .map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-2 font-mono text-[11px] text-fg-secondary"
                >
                  <svg
                    aria-hidden
                    className="h-3 w-3 shrink-0 text-[color:var(--status-success)]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    viewBox="0 0 16 16"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.5 8.5l3.5 3.5 7-7"
                    />
                  </svg>
                  {r.name} &lt;{r.email}&gt;
                  {r.signed_at && (
                    <span className="text-fg-muted">
                      — {formatDateTime(r.signed_at)}
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Document content                                                    */}
      {/* ------------------------------------------------------------------ */}
      <section className="fx-card overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Document
          </p>
        </div>
        <div className="p-5">
          {envelope.document_content ? (
            <p className="max-h-[480px] overflow-y-auto font-mono text-xs leading-relaxed text-fg-secondary whitespace-pre-wrap">
              {envelope.document_content}
            </p>
          ) : (
            <p className="text-sm text-fg-muted italic">
              No document content stored.
            </p>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Recipients                                                          */}
      {/* ------------------------------------------------------------------ */}
      <section className="fx-card overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Recipients
          </p>
        </div>

        {recipients.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-muted">No recipients.</p>
        ) : (
          <ul role="list" className="divide-y divide-line">
            {recipients.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                {/* Identity + status */}
                <div className="flex items-center gap-3">
                  {/* Routing order bubble */}
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-1 font-mono text-[10px] text-fg-muted">
                    {r.routing_order}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg-primary">
                      {r.name}
                    </p>
                    <p className="truncate font-mono text-[11px] text-fg-muted">
                      {r.email}
                    </p>
                    {r.signed_at && (
                      <p className="font-mono text-[10px] text-fg-muted">
                        Signed {formatDateTime(r.signed_at)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pl-10 sm:pl-0">
                  <RecipientStatusBadge status={r.status} />
                  <CopyButton token={r.signing_token} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Audit trail                                                         */}
      {/* ------------------------------------------------------------------ */}
      <section className="fx-card overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Activity
          </p>
        </div>

        {events.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-muted">No events recorded.</p>
        ) : (
          <ol role="list" className="px-5 py-4">
            {events.map((ev, idx) => {
              const isLast = idx === events.length - 1;
              const icon = EVENT_ICON[ev.event_type];
              const label = EVENT_LABEL[ev.event_type] ?? ev.event_type;
              return (
                <li key={ev.id} className="relative flex gap-3">
                  {/* Vertical connector */}
                  {!isLast && (
                    <span
                      aria-hidden
                      className="absolute left-[13px] top-6 h-full w-px bg-line"
                    />
                  )}

                  {/* Icon bubble */}
                  <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-1 text-fg-secondary">
                    {icon ?? (
                      <span className="h-1.5 w-1.5 rounded-full bg-fg-muted" />
                    )}
                  </span>

                  {/* Content */}
                  <div className="flex-1 pb-4">
                    <p className="text-sm text-fg-primary">{label}</p>
                    <p className="font-mono text-[10px] text-fg-muted">
                      {formatDateTime(ev.created_at)}
                    </p>
                    {ev.metadata &&
                      typeof ev.metadata === "object" &&
                      Object.keys(ev.metadata).length > 0 && (
                        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                          {Object.entries(ev.metadata)
                            .filter(([, v]) => v !== null && v !== undefined)
                            .map(([k, v]) => (
                              <li
                                key={k}
                                className="font-mono text-[10px] text-fg-muted"
                              >
                                <span className="text-fg-secondary">{k}:</span>{" "}
                                {String(v)}
                              </li>
                            ))}
                        </ul>
                      )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
