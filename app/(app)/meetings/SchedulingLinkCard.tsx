"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { detectTimezone, formatSlotFull } from "@/lib/meetings/scheduling";
import type { HostBooking, HostEventType, HostSchedulingPage, SchedulingSnapshot } from "./scheduling-types";
import { SchedulingSettings } from "./SchedulingSettings";

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

  async function decide(booking: HostBooking, action: "approve" | "decline" | "cancel") {
    setBusyId(booking.id);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/scheduling/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "That didn't work.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusyId(null);
    }
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
      <div className="mx-auto w-full max-w-3xl px-4">
        <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-5 text-sm text-[var(--fg-muted)]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--gold-400)] border-t-transparent" />
          Loading your scheduling link…
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return error ? (
      <div className="mx-auto w-full max-w-3xl px-4">
        <p className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-4 text-sm text-[var(--fg-muted)]">
          {error}
        </p>
      </div>
    ) : null;
  }

  const pending = snapshot.bookings.filter((b) => b.status === "pending");
  const confirmed = snapshot.bookings.filter((b) => b.status === "confirmed");
  const activeTypes = snapshot.eventTypes.filter((t) => t.isActive);

  return (
    <div className="mx-auto w-full max-w-3xl px-4">
      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-3 py-2.5">
        {/* One line at rest. The link is the whole point of this card; the
            bookings behind it only earn space when you ask for them, and only
            a pending approval is loud enough to announce itself. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-[var(--gold-400)]" title="Your scheduling link">
            <LinkIcon />
          </span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--fg-secondary)]">
            {snapshot.bookingUrl}
          </code>

          {pending.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpenList(openList === "pending" ? null : "pending")}
              aria-expanded={openList === "pending"}
              className="shrink-0 rounded-lg border border-[var(--gold-400)]/40 bg-[var(--gold-400)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--gold-400)] transition-colors hover:bg-[var(--gold-400)]/20"
            >
              {pending.length} waiting on you
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => void copyLink()}
            className="shrink-0 rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--gold-500)]"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="shrink-0 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs font-medium text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
          >
            Manage availability
          </button>
        </div>

        {/* A link nobody can book through is worth interrupting for — these
            only render when the link is actually broken. */}
        {!snapshot.page.isActive ? (
          <p className="mt-2 text-xs text-[var(--fg-muted)]">
            This link is turned off — visitors can&rsquo;t book. Turn it on under Manage availability.
          </p>
        ) : activeTypes.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--fg-muted)]">
            No meeting types are visible yet, so there&rsquo;s nothing to book. Add one under Manage availability.
          </p>
        ) : null}

        {error ? <p className="mt-2 text-xs text-[var(--status-danger)]">{error}</p> : null}

        {confirmed.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpenList(openList === "confirmed" ? null : "confirmed")}
            aria-expanded={openList === "confirmed"}
            className="mt-2 text-xs text-[var(--fg-muted)] underline-offset-2 transition-colors hover:text-[var(--fg-primary)] hover:underline"
          >
            {confirmed.length} booked through your link
          </button>
        ) : null}

        {openList === "pending" ? (
          <ul className="mt-2 flex flex-col gap-2">
            {pending.map((booking) => (
              <li
                key={booking.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--gold-400)]/30 bg-[var(--gold-400)]/5 px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-[var(--fg-primary)]">
                    {booking.inviteeName} · {booking.eventTitle ?? "Meeting"}
                  </span>
                  <span className="text-xs text-[var(--fg-muted)]">
                    {formatSlotFull(booking.startsAt, viewerTimezone)}
                  </span>
                  {booking.inviteeNotes ? (
                    <span className="mt-1 text-xs text-[var(--fg-secondary)]">&ldquo;{booking.inviteeNotes}&rdquo;</span>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === booking.id}
                    onClick={() => void decide(booking, "approve")}
                    className="rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--gold-500)] disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === booking.id}
                    onClick={() => void decide(booking, "decline")}
                    className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--fg-muted)] transition-colors hover:text-[var(--status-danger)] disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {openList === "confirmed" ? (
          <ul className="mt-2 flex flex-col gap-2">
            {confirmed.slice(0, 5).map((booking) => (
              <li
                key={booking.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-[var(--fg-primary)]">
                    {booking.inviteeName} · {booking.eventTitle ?? "Meeting"}
                  </span>
                  <span className="text-xs text-[var(--fg-muted)]">
                    {formatSlotFull(booking.startsAt, viewerTimezone)}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busyId === booking.id}
                  onClick={() => void decide(booking, "cancel")}
                  className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--fg-muted)] transition-colors hover:text-[var(--status-danger)] disabled:opacity-50"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {settingsOpen && mounted
        ? createPortal(
            // Portaled to <body> for the same reason as the calendar overlay: the
            // app shell's transform would otherwise trap a `fixed inset-0` layer.
            <div className="fixed inset-0 z-50 flex flex-col bg-[var(--surface-0)]">
              <header className="flex shrink-0 items-center justify-between border-b border-[var(--line)] bg-[var(--surface-1)] px-4 py-3 sm:px-6">
                <h2 className="text-base font-semibold text-[var(--fg-primary)]">Scheduling link</h2>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
                >
                  Close
                </button>
              </header>
              <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
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

function LinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

