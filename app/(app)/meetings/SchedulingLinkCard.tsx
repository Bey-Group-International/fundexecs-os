"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BOOKING_REASON_MAX, detectTimezone, formatSlotFull } from "@/lib/meetings/scheduling";
import type { HostBooking, HostEventType, HostSchedulingPage, SchedulingSnapshot } from "./scheduling-types";
import nextDynamic from "next/dynamic";

// Loaded when the settings panel opens, not with the landing page: most visits
// never open it, and it is the largest thing this card could render.
const SchedulingSettings = nextDynamic(
  () => import("./SchedulingSettings").then((m) => m.SchedulingSettings),
  { ssr: false, loading: () => <p className="text-sm text-[var(--fg-muted)]">Loading settings…</p> },
);

/**
 * The member's own scheduling link on the Meetings landing. One line at rest:
 * the link, Copy, and Manage availability. Bookings expand from there — a
 * pending request gets a loud chip because it's the only part that's waiting
 * on the member; confirmed bookings sit behind a quiet count. The link itself
 * is created lazily by GET /api/meetings/scheduling the first time this mounts,
 * so there's nothing to set up before sharing.
 *
 * There is no "Manage calendar" button here any more: it opened the very same
 * overlay as the lobby's "Schedule for later", so the calendar had two doors
 * with different names. The lobby owns that door now.
 */
export function SchedulingLinkCard() {
  const [snapshot, setSnapshot] = useState<SchedulingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Which booking list, if any, is expanded under the link row. */
  const [openList, setOpenList] = useState<"pending" | "confirmed" | null>(null);
  /**
   * The decline or cancel waiting on a second click. Both email the invitee
   * and cannot be undone, so neither happens on the first click, and the
   * second is where the host can say why.
   */
  const [confirming, setConfirming] = useState<{ id: string; action: "decline" | "cancel" } | null>(null);
  const [reason, setReason] = useState("");
  /**
   * A move in progress: the booking and the new time, as a local
   * `datetime-local` value. The host is not held to their own published hours,
   * so any time can be picked here.
   */
  const [moving, setMoving] = useState<{ id: string; value: string } | null>(null);
  /**
   * An approve or move the server warned about: the time overlaps something on
   * the host's own calendar. Waiting on "anyway" or "back".
   */
  const [overriding, setOverriding] = useState<{ id: string; message: string; body: BookingAction } | null>(null);
  const [showAllConfirmed, setShowAllConfirmed] = useState(false);
  const [viewerTimezone, setViewerTimezone] = useState("UTC");

  useEffect(() => {
    setMounted(true);
    setViewerTimezone(detectTimezone());
  }, []);

  const load = useCallback(async () => {
    try {
      // The zone is read here rather than from state: it only matters on the
      // first call, which creates the page, and waiting for an effect to
      // populate state would race that creation.
      const res = await fetch(
        `/api/meetings/scheduling?timezone=${encodeURIComponent(detectTimezone())}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not load your scheduling link.");
      }
      setSnapshot((await res.json()) as SchedulingSnapshot);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your scheduling link.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape closes the availability panel. The calendar overlay belongs to the
  // landing now, and closes itself.
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSettingsOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  async function copyLink() {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(snapshot.bookingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select the link and copy it manually.");
    }
  }

  async function act(booking: HostBooking, body: BookingAction) {
    setBusyId(booking.id);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/scheduling/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; overridable?: boolean };
      // A clash with the host's own calendar is theirs to overrule. Ask once,
      // in place, rather than refusing or silently booking over it.
      if (res.status === 409 && data.overridable === true && !body.allowConflict) {
        setOverriding({ id: booking.id, message: data.error ?? "That time overlaps something on your calendar.", body });
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "That didn't work.");
      setConfirming(null);
      setMoving(null);
      setOverriding(null);
      setReason("");
      await load();
    } catch (err) {
      setOverriding(null);
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusyId(null);
    }
  }

  function decide(booking: HostBooking, action: "approve" | "decline" | "cancel") {
    return act(booking, action === "approve" ? { action } : { action, reason: reason.trim() || undefined });
  }

  function startMove(booking: HostBooking) {
    setConfirming(null);
    setOverriding(null);
    setMoving({ id: booking.id, value: toLocalInput(booking.startsAt) });
  }

  function submitMove(booking: HostBooking) {
    if (!moving?.value) return;
    const start = new Date(moving.value);
    if (isNaN(start.getTime())) {
      setError("Pick a valid date and time.");
      return;
    }
    void act(booking, { action: "reschedule", startIso: start.toISOString() });
  }

  /** The controls under a booking, whichever step the host is on. */
  function bookingControls(booking: HostBooking, primary: ReactNode) {
    const working = busyId === booking.id;
    if (overriding?.id === booking.id) {
      const verb = overriding.body.action === "approve" ? "Approve anyway" : "Move anyway";
      return (
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[18rem]">
          <span role="alert" className="text-xs text-[var(--status-warning)]">
            {overriding.message} Invitees still can&rsquo;t book that time.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={working}
              onClick={() => void act(booking, { ...overriding.body, allowConflict: true })}
              className="fx-btn rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gold-500 disabled:opacity-50"
            >
              {working ? "Working…" : verb}
            </button>
            <button
              type="button"
              disabled={working}
              onClick={() => setOverriding(null)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg-muted hover:text-fg-primary"
            >
              Back
            </button>
          </div>
        </div>
      );
    }
    if (moving?.id === booking.id) {
      return (
        <form
          className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[18rem]"
          onSubmit={(e) => {
            e.preventDefault();
            submitMove(booking);
          }}
        >
          <label className="text-xs text-fg-secondary" htmlFor={`move-${booking.id}`}>
            New time for {booking.inviteeName} — any time works; they&apos;ll be emailed.
          </label>
          <input
            id={`move-${booking.id}`}
            type="datetime-local"
            value={moving.value}
            onChange={(e) => setMoving({ id: booking.id, value: e.target.value })}
            required
            className="w-full rounded-lg border border-line bg-surface-0 px-2.5 py-1.5 text-xs text-fg-primary focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={working || !moving.value}
              className="fx-btn rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gold-500 disabled:opacity-50"
            >
              {working ? "Moving…" : "Move booking"}
            </button>
            <button
              type="button"
              disabled={working}
              onClick={() => setMoving(null)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg-muted hover:text-fg-primary"
            >
              Back
            </button>
          </div>
        </form>
      );
    }
    return primary;
  }

  function applyPage(page: HostSchedulingPage) {
    setSnapshot((s) =>
      s ? { ...s, page, bookingUrl: s.bookingUrl.replace(/\/book\/[^/]+$/, `/book/${page.slug}`) } : s,
    );
  }

  function applyEventTypes(eventTypes: HostEventType[]) {
    setSnapshot((s) => (s ? { ...s, eventTypes } : s));
  }

  if (loading) {
    return (
      <div className="w-full">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-1 px-4 py-5 text-sm text-fg-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--gold-400)] border-t-transparent" />
          Loading your scheduling link…
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return error ? (
      <div className="w-full">
        <p className="rounded-xl border border-line bg-surface-1 px-4 py-4 text-sm text-fg-muted">
          {error}
        </p>
      </div>
    ) : null;
  }

  const pending = snapshot.bookings.filter((b) => b.status === "pending");
  const confirmed = snapshot.bookings.filter((b) => b.status === "confirmed");
  const activeTypes = snapshot.eventTypes.filter((t) => t.isActive);

  return (
    <div className="w-full">
      <section className="fx-card px-3 py-2.5">
        {/* One line at rest. The link is the whole point of this card; the
            bookings behind it only earn space when you ask for them, and only
            a pending approval is loud enough to announce itself. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-[var(--gold-300)]" title="Your scheduling link">
            <LinkIcon />
          </span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg-secondary">
            {snapshot.bookingUrl}
          </code>

          {pending.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpenList(openList === "pending" ? null : "pending")}
              aria-expanded={openList === "pending"}
              className="fx-btn shrink-0 rounded-lg border border-status-warning/45 bg-status-warning/10 px-2.5 py-1.5 text-xs font-semibold text-[var(--status-warning)] hover:bg-status-warning/20"
            >
              {pending.length} waiting on you
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => void copyLink()}
            className="fx-btn shrink-0 rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gold-500"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="fx-btn shrink-0 rounded-lg border border-line bg-surface-1 px-2.5 py-1.5 text-xs font-medium text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
          >
            Manage availability
          </button>
        </div>

        {/* A link nobody can book through is worth interrupting for — these
            only render when the link is actually broken. */}
        {!snapshot.page.isActive ? (
          <p className="mt-2 text-xs text-fg-muted">
            This link is turned off — visitors can&rsquo;t book. Turn it on under Manage availability.
          </p>
        ) : activeTypes.length === 0 ? (
          <p className="mt-2 text-xs text-fg-muted">
            No meeting types are visible yet, so there&rsquo;s nothing to book. Add one under Manage availability.
          </p>
        ) : null}

        {error ? <p role="alert" className="mt-2 text-xs text-[var(--status-danger)]">{error}</p> : null}

        {confirmed.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpenList(openList === "confirmed" ? null : "confirmed")}
            aria-expanded={openList === "confirmed"}
            className="fx-focus mt-2 rounded text-xs text-fg-muted underline-offset-2 transition-colors hover:text-fg-primary hover:underline"
          >
            {confirmed.length} booked through your link
          </button>
        ) : null}

        {openList === "pending" ? (
          <ul className="mt-2 flex flex-col gap-2">
            {pending.map((booking) => (
              <li
                key={booking.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-status-warning/35 bg-status-warning/5 px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-fg-primary">
                    {booking.inviteeName} · {booking.eventTitle ?? "Meeting"}
                  </span>
                  <span className="text-xs text-fg-muted">
                    {formatSlotFull(booking.startsAt, viewerTimezone)}
                  </span>
                  <GuestLine guests={booking.inviteeGuests} />
                  {booking.inviteeNotes ? (
                    <span className="mt-1 text-xs text-fg-secondary">&ldquo;{booking.inviteeNotes}&rdquo;</span>
                  ) : null}
                </div>
                {confirming?.id === booking.id ? (
                  <ConfirmRow
                    label={`Decline ${booking.inviteeName}'s request?`}
                    confirmLabel="Decline request"
                    reason={reason}
                    onReason={setReason}
                    busy={busyId === booking.id}
                    onConfirm={() => void decide(booking, "decline")}
                    onBack={() => { setConfirming(null); setReason(""); }}
                  />
                ) : (
                  bookingControls(
                    booking,
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyId === booking.id}
                        onClick={() => void decide(booking, "approve")}
                        className="fx-btn rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gold-500"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busyId === booking.id}
                        onClick={() => startMove(booking)}
                        className="fx-btn rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-xs font-medium text-fg-secondary hover:text-fg-primary"
                      >
                        Reschedule
                      </button>
                      <button
                        type="button"
                        disabled={busyId === booking.id}
                        onClick={() => { setMoving(null); setOverriding(null); setConfirming({ id: booking.id, action: "decline" }); setReason(""); }}
                        className="fx-btn rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-xs font-medium text-fg-secondary hover:border-status-danger/40 hover:text-[var(--status-danger)]"
                      >
                        Decline
                      </button>
                    </div>,
                  )
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {openList === "confirmed" ? (
          <ul className="mt-2 flex flex-col gap-2">
            {(showAllConfirmed ? confirmed : confirmed.slice(0, 5)).map((booking) => (
              <li
                key={booking.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-0 px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-fg-primary">
                    {booking.inviteeName} · {booking.eventTitle ?? "Meeting"}
                  </span>
                  <span className="text-xs text-fg-muted">
                    {formatSlotFull(booking.startsAt, viewerTimezone)}
                  </span>
                  <GuestLine guests={booking.inviteeGuests} />
                </div>
                {confirming?.id === booking.id ? (
                  <ConfirmRow
                    label={`Cancel the meeting with ${booking.inviteeName}?`}
                    confirmLabel="Cancel meeting"
                    reason={reason}
                    onReason={setReason}
                    busy={busyId === booking.id}
                    onConfirm={() => void decide(booking, "cancel")}
                    onBack={() => { setConfirming(null); setReason(""); }}
                  />
                ) : (
                  bookingControls(
                    booking,
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyId === booking.id}
                        onClick={() => startMove(booking)}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg-primary disabled:opacity-50"
                      >
                        Reschedule
                      </button>
                      <button
                        type="button"
                        disabled={busyId === booking.id}
                        onClick={() => { setMoving(null); setOverriding(null); setConfirming({ id: booking.id, action: "cancel" }); setReason(""); }}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-[var(--status-danger)] disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>,
                  )
                )}
              </li>
            ))}
            {confirmed.length > 5 ? (
              <li>
                <button
                  type="button"
                  onClick={() => setShowAllConfirmed((v) => !v)}
                  className="fx-focus rounded text-xs text-fg-muted underline-offset-2 hover:text-fg-primary hover:underline"
                >
                  {showAllConfirmed ? "Show fewer" : `Show all ${confirmed.length}`}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </section>

      {settingsOpen && mounted
        ? createPortal(
            // Portaled to <body> for the same reason as the calendar overlay: the
            // app shell's transform would otherwise trap a `fixed inset-0` layer.
            <div className="fixed inset-0 z-50 flex flex-col bg-surface-0">
              <header className="flex shrink-0 items-center justify-between border-b border-line bg-surface-1 px-4 py-3 sm:px-6">
                <h2 className="text-base font-semibold text-fg-primary">Scheduling link</h2>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:text-fg-primary"
                >
                  Close
                </button>
              </header>
              <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6">
                <div className="mx-auto w-full max-w-2xl">
                  <SchedulingSettings
                    page={snapshot.page}
                    eventTypes={snapshot.eventTypes}
                    onPageChange={applyPage}
                    onEventTypesChange={applyEventTypes}
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

    </div>
  );
}

/** What the host can ask of one booking. */
type BookingAction =
  | { action: "approve"; allowConflict?: boolean }
  | { action: "decline" | "cancel"; reason?: string; allowConflict?: boolean }
  | { action: "reschedule"; startIso: string; allowConflict?: boolean };

/** An instant as a `datetime-local` value in this browser's zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function LinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}


/** Who else the invitee is bringing, when anyone. */
function GuestLine({ guests }: { guests?: string[] }) {
  if (!guests || guests.length === 0) return null;
  return (
    <span className="mt-0.5 truncate text-xs text-fg-muted" title={guests.join(", ")}>
      + {guests.length === 1 ? guests[0] : `${guests.length} guests: ${guests.join(", ")}`}
    </span>
  );
}

/**
 * The second click on a decline or cancel. Says who hears about it, and takes
 * an optional reason that goes into their email.
 */
function ConfirmRow({
  label,
  confirmLabel,
  reason,
  onReason,
  busy,
  onConfirm,
  onBack,
}: {
  label: string;
  confirmLabel: string;
  reason: string;
  onReason: (v: string) => void;
  busy: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[18rem]">
      <span className="text-xs text-fg-secondary">{label} They&apos;ll be emailed.</span>
      <input
        type="text"
        value={reason}
        onChange={(e) => onReason(e.target.value)}
        maxLength={BOOKING_REASON_MAX}
        placeholder="Reason (optional, included in the email)"
        aria-label="Reason"
        className="w-full rounded-lg border border-line bg-surface-0 px-2.5 py-1.5 text-xs text-fg-primary focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="fx-btn rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-1.5 text-xs font-semibold text-[var(--status-danger)] disabled:opacity-50"
        >
          {busy ? "Working…" : confirmLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onBack}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg-muted hover:text-fg-primary"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
