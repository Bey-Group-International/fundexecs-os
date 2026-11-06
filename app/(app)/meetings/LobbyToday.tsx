"use client";

// The Meetings home's day at a glance, and the booking requests waiting on the
// host, brought into the "Needs you" list beside prep and follow-ups.

import { useCallback, useEffect, useState } from "react";
import type { PendingBookingRequest } from "@/lib/meetings/booking-requests";
import { todayChips, type TodayChipTarget, type TodaySummary } from "@/lib/meetings/lobby-today";
import { CARD, chip } from "./tone";

/** How far ahead the home looks for requests waiting on a decision. */
const REQUEST_HORIZON_DAYS = 90;

/** The host's pending booking requests; empty, not an error, when they cannot be read. */
export function useBookingRequests() {
  const [requests, setRequests] = useState<PendingBookingRequest[]>([]);
  const load = useCallback(async () => {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + REQUEST_HORIZON_DAYS * 86_400_000).toISOString();
    try {
      const res = await fetch(
        `/api/meetings/scheduling/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const body = (await res.json()) as { requests?: PendingBookingRequest[] };
      setRequests(Array.isArray(body.requests) ? body.requests : []);
    } catch {
      // The rest of the list stands without them.
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { requests, reload: load, setRequests };
}

const TONE: Record<"neutral" | "warning" | "info", Parameters<typeof chip>[0]> = {
  neutral: "neutral",
  warning: "warning",
  info: "info",
};

/** "3 more today · 2h 30m", "1 booking request", "2 need prep" — each opens its list. */
export function TodayChips({ summary, onOpen }: { summary: TodaySummary; onOpen: (target: TodayChipTarget) => void }) {
  const chips = todayChips(summary);
  return (
    <nav aria-label="Today at a glance" className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">Today</span>
      {chips.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={() => onOpen(c.target)}
          className={`${chip(TONE[c.tone])} min-h-9 cursor-pointer transition-opacity hover:opacity-80 sm:min-h-0`}
        >
          {c.label}
        </button>
      ))}
    </nav>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * One booking request in the "Needs you" list: who, for what, when, with
 * Approve in one press and Decline in two — declining emails a stranger and
 * cannot be taken back.
 */
export function BookingRequestRow({
  request,
  onDecided,
}: {
  request: PendingBookingRequest;
  onDecided: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "approve" | "decline", allowConflict = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/scheduling/bookings/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(allowConflict ? { action, allowConflict: true } : { action }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; overridable?: boolean };
      if (res.status === 409 && body.overridable && action === "approve") {
        setConflict(body.error ?? "That time overlaps something on your calendar.");
        return;
      }
      if (!res.ok) throw new Error(body.error ?? "That didn't work.");
      onDecided(request.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-request={request.id} className={`${CARD} flex flex-col gap-2 px-3 py-2.5`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-medium text-fg-primary">
            {request.inviteeName} · {request.eventTitle ?? "Meeting"}
          </span>
          <span className="flex flex-wrap items-center gap-1">
            <span className={chip("warning")}>Booking request</span>
            <span className="text-[11px] text-fg-muted">{when(request.startsAt)}</span>
          </span>
        </span>
        {confirmDecline ? (
          <span className="flex items-center gap-2">
            <span className="text-xs text-fg-secondary">Decline and email {request.inviteeName}?</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide("decline")}
              className="fx-btn min-h-9 rounded-lg border border-status-danger/40 px-3 text-xs font-semibold text-[var(--status-danger)] disabled:opacity-50"
            >
              Decline
            </button>
            <button type="button" onClick={() => setConfirmDecline(false)} className="min-h-9 px-2 text-xs text-fg-muted">
              Back
            </button>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide("approve")}
              className="fx-btn min-h-9 rounded-lg bg-[var(--gold-400)] px-3 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmDecline(true)}
              className="fx-btn min-h-9 rounded-lg border border-line px-3 text-xs font-medium text-fg-secondary hover:text-fg-primary disabled:opacity-50"
            >
              Decline
            </button>
          </span>
        )}
      </div>
      {request.inviteeNotes ? (
        <p className="line-clamp-3 whitespace-pre-line text-xs text-fg-secondary">{request.inviteeNotes}</p>
      ) : null}
      {conflict ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--status-warning)]">
          {conflict}
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide("approve", true)}
            className="rounded-md border border-status-warning/40 px-2 py-0.5 font-semibold disabled:opacity-50"
          >
            Approve anyway
          </button>
        </p>
      ) : null}
      {error ? <p role="alert" className="text-xs text-[var(--status-danger)]">{error}</p> : null}
    </div>
  );
}
