"use client";

import { useCallback, useEffect, useState } from "react";
import { SlotPicker } from "@/components/scheduling/SlotPicker";
import { TimezoneSelect } from "@/components/scheduling/TimezoneSelect";
import { detectTimezone, formatSlotFull, type SlotWindow } from "@/lib/meetings/scheduling";

interface BookingView {
  booking: {
    id: string;
    eventTitle: string | null;
    inviteeName: string;
    startsAt: string;
    endsAt: string;
    status: "pending" | "confirmed" | "declined" | "cancelled";
    cancelledBy: "host" | "invitee" | null;
    cancellationReason: string | null;
    inviteeTimezone: string;
  };
  page: { slug: string; displayName: string };
  eventType: { title: string; durationMinutes: number };
  joinUrl: string | null;
  bookingPageUrl: string;
  slots: SlotWindow[];
}

const STATUS_COPY: Record<BookingView["booking"]["status"], { label: string; tone: string }> = {
  confirmed: { label: "Confirmed", tone: "text-[var(--gold-400)]" },
  pending: { label: "Waiting on the host", tone: "text-[var(--fg-secondary)]" },
  declined: { label: "Declined", tone: "text-[var(--status-danger)]" },
  cancelled: { label: "Cancelled", tone: "text-[var(--status-danger)]" },
};

export function ManageBooking({ token }: { token: string }) {
  const [view, setView] = useState<BookingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [mode, setMode] = useState<"view" | "reschedule" | "cancel">("view");
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/scheduling/booking/${token}`, { cache: "no-store" });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error("Could not load this booking.");
      const data = (await res.json()) as BookingView;
      setView(data);
      // Show times in the zone they booked in, unless this browser says otherwise.
      setTimezone(detectTimezone() || data.booking.inviteeTimezone);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this booking.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: "cancel" | "reschedule") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/scheduling/booking/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          startIso: action === "reschedule" ? selected : undefined,
          reason: action === "cancel" ? reason : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "That didn't work.");
      setMode("view");
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--fg-muted)]">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--gold-400)] border-t-transparent" />
        Loading your booking…
      </div>
    );
  }

  if (notFound || !view) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--fg-secondary)]">This booking link is invalid or has expired.</p>
        {error ? <p className="text-xs text-[var(--status-danger)]">{error}</p> : null}
      </div>
    );
  }

  const { booking, page, eventType } = view;
  const status = STATUS_COPY[booking.status];
  const changeable = booking.status === "confirmed" || booking.status === "pending";
  const isPast = new Date(booking.endsAt).getTime() < Date.now();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className={`font-mono text-[10px] uppercase tracking-wider ${status.tone}`}>{status.label}</span>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--fg-primary)]">{eventType.title}</h1>
        <p className="text-sm text-[var(--fg-secondary)]">with {page.displayName}</p>
      </header>

      <div className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-5">
        <Row label="When" value={formatSlotFull(booking.startsAt, timezone)} />
        <Row label="Length" value={`${eventType.durationMinutes} minutes`} />
        <Row label="Booked by" value={booking.inviteeName} />
        {booking.cancellationReason ? <Row label="Reason" value={booking.cancellationReason} /> : null}
        <div className="pt-1">
          <TimezoneSelect value={timezone} onChange={setTimezone} />
        </div>
      </div>

      {booking.status === "confirmed" && view.joinUrl && !isPast ? (
        <a
          href={view.joinUrl}
          className="w-fit rounded-lg bg-[var(--gold-400)] px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[var(--gold-500)]"
        >
          Join meeting →
        </a>
      ) : null}

      {booking.status === "pending" ? (
        <p className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-4 py-3 text-xs text-[var(--fg-muted)]">
          {page.displayName} still needs to confirm this time. We&rsquo;ll email you as soon as they do.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-[var(--status-danger)]/20 bg-[var(--status-danger)]/10 px-3 py-2 text-xs text-[var(--status-danger)]">
          {error}
        </p>
      ) : null}

      {changeable && !isPast ? (
        mode === "view" ? (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setMode("reschedule")}
              className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
            >
              Reschedule
            </button>
            <button
              type="button"
              onClick={() => setMode("cancel")}
              className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--fg-muted)] transition-colors hover:text-[var(--status-danger)]"
            >
              Cancel booking
            </button>
          </div>
        ) : mode === "reschedule" ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[var(--fg-secondary)]">Pick a new time.</p>
            <SlotPicker
              slots={view.slots}
              timezone={timezone}
              selected={selected}
              onSelect={setSelected}
              emptyMessage={`${page.displayName} has no other open times right now.`}
            />
            <div className="flex gap-3">
              <button
                type="button"
                disabled={!selected || busy}
                onClick={() => void act("reschedule")}
                className="rounded-lg bg-[var(--gold-400)] px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[var(--gold-500)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Moving…" : "Confirm new time"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("view");
                  setSelected(null);
                }}
                className="rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm font-medium text-[var(--fg-muted)]"
              >
                Never mind
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-[var(--fg-secondary)]">Reason (optional — shared with the host)</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
              />
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("cancel")}
                className="rounded-lg border border-[var(--status-danger)]/40 bg-[var(--status-danger)]/10 px-4 py-2.5 text-sm font-semibold text-[var(--status-danger)] transition-colors hover:bg-[var(--status-danger)]/20 disabled:opacity-50"
              >
                {busy ? "Cancelling…" : "Cancel this booking"}
              </button>
              <button
                type="button"
                onClick={() => setMode("view")}
                className="rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm font-medium text-[var(--fg-muted)]"
              >
                Keep it
              </button>
            </div>
          </div>
        )
      ) : (
        <a href={view.bookingPageUrl} className="w-fit text-sm text-[var(--gold-400)] hover:underline">
          Book another time with {page.displayName} →
        </a>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="w-20 shrink-0 text-xs text-[var(--fg-muted)]">{label}</span>
      <span className="text-sm text-[var(--fg-primary)]">{value}</span>
    </div>
  );
}
