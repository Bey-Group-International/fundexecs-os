"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SlotPicker } from "@/components/scheduling/SlotPicker";
import { TimezoneSelect } from "@/components/scheduling/TimezoneSelect";
import { useRefreshWhenStale } from "@/components/scheduling/useRefreshWhenStale";
import {
  BOOKING_EMAIL_MAX,
  BOOKING_GUESTS_MAX,
  BOOKING_NAME_MAX,
  BOOKING_NOTES_MAX,
  detectTimezone,
  formatSlotFull,
  type SlotWindow,
} from "@/lib/meetings/scheduling";

interface PublicEventType {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  requiresApproval: boolean;
}

interface BookedState {
  status: "pending" | "confirmed";
  startIso: string;
  joinUrl: string | null;
  manageUrl: string;
  calendarUrl: string | null;
  emailed: boolean;
}

/**
 * Pick a time, then say who you are. Slots are re-fetched whenever the range
 * changes, and the server re-checks the chosen time on submit — so a slot taken
 * while this page sat open surfaces as a 409 the invitee can recover from
 * rather than a silent double-booking.
 */
export function BookingFlow({
  slug,
  hostName,
  eventType,
  initialSlots,
}: {
  slug: string;
  hostName: string;
  eventType: PublicEventType;
  /**
   * The open times the server already worked out while rendering the page.
   * With them the picker paints at once; without them (the server read failed)
   * it fetches as it always did.
   */
  initialSlots?: SlotWindow[];
}) {
  const [timezone, setTimezone] = useState("UTC");
  const [slots, setSlots] = useState<SlotWindow[]>(initialSlots ?? []);
  const [loading, setLoading] = useState(initialSlots === undefined);
  const [selected, setSelected] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [guests, setGuests] = useState("");
  const [showGuests, setShowGuests] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [booked, setBooked] = useState<BookedState | null>(null);

  // Resolve the viewer's zone after mount: on the server there is no such thing,
  // and rendering UTC first keeps hydration stable.
  useEffect(() => setTimezone(detectTimezone()), []);

  // Set after every successful load, below; declared first so the loader can
  // call it.
  const markFreshRef = useRef<() => void>(() => {});

  /**
   * `quiet` is the background refresh when someone comes back to the tab: it
   * keeps the grid on screen instead of flashing a spinner, and a failure
   * leaves the times they were looking at rather than replacing them with an
   * error about a request they never made.
   */
  const loadSlots = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      if (!quiet) setLoading(true);
      try {
        const res = await fetch(`/api/scheduling/${slug}/${eventType.slug}/slots`, { cache: "no-store" });
        if (!res.ok) throw new Error("Could not load available times.");
        const data = (await res.json()) as { slots: SlotWindow[] };
        const next = data.slots ?? [];
        setSlots(next);
        markFreshRef.current();
      } catch (err) {
        if (!quiet) setError(err instanceof Error ? err.message : "Could not load available times.");
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [slug, eventType.slug],
  );

  // The time they had picked went while they were away: say so, rather than
  // letting them fill in the form for a slot the server will refuse.
  useEffect(() => {
    if (selected && !slots.some((s) => s.start === selected)) {
      setSelected(null);
      setError("The time you picked is no longer available. Please choose another.");
    }
  }, [slots, selected]);

  // Picking a new time is the answer to any earlier "that time is gone".
  const selectSlot = useCallback((start: string) => {
    setSelected(start);
    setError(null);
  }, []);

  markFreshRef.current = useRefreshWhenStale(() => void loadSlots({ quiet: true }), {
    enabled: !booked && !submitting,
  });

  // The first load is skipped when the server sent the slots with the page.
  // It used to be the only load: render, hydrate, THEN ask for times — so every
  // visitor watched a spinner for a round trip the server had already made.
  // Later reloads (a 409 on submit) still go through `loadSlots`.
  const serverSlots = useRef(initialSlots !== undefined);
  useEffect(() => {
    if (serverSlots.current) {
      serverSlots.current = false;
      return;
    }
    void loadSlots();
  }, [loadSlots]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch(`/api/scheduling/${slug}/${eventType.slug}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startIso: selected, name, email, notes, timezone, guests }),
      });
      const data = (await res.json()) as {
        error?: string;
        fieldErrors?: Record<string, string>;
        status?: "pending" | "confirmed";
        joinUrl?: string | null;
        manageUrl?: string;
        calendarUrl?: string | null;
        emailed?: boolean;
      };
      if (!res.ok) {
        setFieldErrors(data.fieldErrors ?? {});
        // 409 means the slot went while this page was open — refresh the grid so
        // the next pick is from live availability.
        if (res.status === 409) {
          setSelected(null);
          await loadSlots();
        }
        throw new Error(data.error ?? "Could not book this time.");
      }
      setBooked({
        status: data.status ?? "confirmed",
        startIso: selected,
        joinUrl: data.joinUrl ?? null,
        manageUrl: data.manageUrl ?? "",
        calendarUrl: data.calendarUrl ?? null,
        // An older server that doesn't report this did send the email.
        emailed: data.emailed ?? true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not book this time.");
    } finally {
      setSubmitting(false);
    }
  }

  if (booked) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-[var(--gold-400)]/30 bg-[var(--gold-400)]/5 px-5 py-6">
        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--gold-400)]">
          <CheckIcon />
          {booked.status === "pending" ? "Request sent" : "You're booked"}
        </span>
        <p className="text-sm text-[var(--fg-primary)]">{formatSlotFull(booked.startIso, timezone)}</p>
        <p className="text-sm text-[var(--fg-muted)]">
          {booked.status === "pending"
            ? booked.emailed
              ? `${hostName} will confirm or decline this time. We've emailed you the details, and you'll hear either way.`
              : `${hostName} will confirm or decline this time. We couldn't email you a copy, so keep the link below to check on it.`
            : booked.emailed
              ? `We've emailed you the details and a link to join. ${hostName} has it on their calendar.`
              : `${hostName} has it on their calendar. We couldn't email you a confirmation, so add it to your calendar and keep the links below.`}
        </p>
        <div className="flex flex-wrap gap-3">
          {booked.joinUrl ? (
            <a
              href={booked.joinUrl}
              className="rounded-lg bg-[var(--gold-400)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--gold-500)]"
            >
              Join link
            </a>
          ) : null}
          {booked.calendarUrl ? (
            <a
              href={booked.calendarUrl}
              className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
            >
              Add to calendar
            </a>
          ) : null}
          {booked.manageUrl ? (
            <a
              href={booked.manageUrl}
              className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
            >
              Reschedule or cancel
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--fg-muted)]">
          {selected ? "Change the time, or confirm your details below." : "Pick a time that works for you."}
        </p>
        <TimezoneSelect value={timezone} onChange={setTimezone} />
      </div>

      <SlotPicker
        slots={slots}
        timezone={timezone}
        selected={selected}
        onSelect={selectSlot}
        loading={loading}
        emptyMessage={`${hostName} has no open times on this link right now.`}
      />

      {selected ? (
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-5">
          <p className="text-sm font-medium text-[var(--fg-primary)]">{formatSlotFull(selected, timezone)}</p>

          <Field label="Your name" error={fieldErrors.name}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              maxLength={BOOKING_NAME_MAX}
              required
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
            />
          </Field>

          <Field label="Your email" error={fieldErrors.email}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              maxLength={BOOKING_EMAIL_MAX}
              required
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
            />
          </Field>

          {showGuests || fieldErrors.guests ? (
            <Field label={`Guests (optional, up to ${BOOKING_GUESTS_MAX})`} error={fieldErrors.guests}>
              <input
                type="text"
                value={guests}
                onChange={(e) => setGuests(e.target.value)}
                placeholder="colleague@company.com, partner@firm.com"
                autoComplete="off"
                maxLength={BOOKING_GUESTS_MAX * (BOOKING_EMAIL_MAX + 2)}
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
              />
            </Field>
          ) : (
            <button
              type="button"
              onClick={() => setShowGuests(true)}
              className="w-fit text-xs font-medium text-[var(--gold-400)] hover:text-[var(--gold-500)]"
            >
              + Add guests
            </button>
          )}

          <Field label="What would you like to cover? (optional)" error={fieldErrors.notes}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={BOOKING_NOTES_MAX}
              rows={3}
              className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
            />
          </Field>

          {error ? (
            <p className="rounded-lg border border-[var(--status-danger)]/20 bg-[var(--status-danger)]/10 px-3 py-2 text-xs text-[var(--status-danger)]">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="flex items-center justify-center gap-2 rounded-lg bg-[var(--gold-400)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--gold-500)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Booking…" : eventType.requiresApproval ? "Request this time" : "Confirm booking"}
          </button>

          {eventType.requiresApproval ? (
            <p className="text-xs text-[var(--fg-muted)]">
              {hostName} confirms each booking on this type. We&rsquo;ll hold the time until they decide.
            </p>
          ) : null}
        </form>
      ) : null}

      {error && !selected ? (
        <p className="rounded-lg border border-[var(--status-danger)]/20 bg-[var(--status-danger)]/10 px-3 py-2 text-xs text-[var(--status-danger)]">
          {error}
        </p>
      ) : null}

      <Link href={`/book/${slug}`} className="w-fit text-xs text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]">
        ← All meeting types
      </Link>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-[var(--fg-secondary)]">{label}</span>
      {children}
      {error ? <span className="text-xs text-[var(--status-danger)]">{error}</span> : null}
    </label>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
