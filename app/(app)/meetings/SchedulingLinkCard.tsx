"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { detectTimezone, formatSlotFull } from "@/lib/meetings/scheduling";
import type { HostBooking, HostEventType, HostSchedulingPage, SchedulingSnapshot } from "./scheduling-types";
import { SchedulingSettings } from "./SchedulingSettings";

/**
 * The member's own scheduling link on the Meetings landing: share it, see who
 * has booked, act on requests waiting for approval, and open the availability
 * editor. The link itself is created lazily by GET /api/meetings/scheduling the
 * first time this mounts, so there's nothing to set up before sharing.
 */
export function SchedulingLinkCard() {
  const [snapshot, setSnapshot] = useState<SchedulingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
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

  // Escape closes the availability overlay, matching the calendar overlay.
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
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
      <div className="mx-auto w-full max-w-5xl px-4">
        <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-5 text-sm text-[var(--fg-muted)]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--gold-400)] border-t-transparent" />
          Loading your scheduling link…
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return error ? (
      <div className="mx-auto w-full max-w-5xl px-4">
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
    <div className="mx-auto w-full max-w-5xl px-4">
      <section className="flex flex-col gap-5 rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-5 sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="inline-flex w-fit items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--gold-400)]">
              <LinkIcon />
              Your scheduling link
            </span>
            <p className="text-sm text-[var(--fg-muted)]">
              Share one link. People pick a time from your real availability and land on your calendar.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
          >
            Manage availability
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 font-mono text-xs text-[var(--fg-secondary)]">
            {snapshot.bookingUrl}
          </code>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="rounded-lg bg-[var(--gold-400)] px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[var(--gold-500)]"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <a
            href={snapshot.bookingUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm font-medium text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
          >
            Preview
          </a>
        </div>

        {!snapshot.page.isActive ? (
          <p className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-xs text-[var(--fg-muted)]">
            This link is turned off — visitors can&rsquo;t book. Turn it on under Manage availability.
          </p>
        ) : activeTypes.length === 0 ? (
          <p className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-xs text-[var(--fg-muted)]">
            No meeting types are visible yet, so there&rsquo;s nothing to book. Add one under Manage availability.
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--fg-muted)]">
            {activeTypes.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1.5">
                <ClockIcon />
                {t.title} · {t.durationMinutes} min
              </span>
            ))}
          </div>
        )}

        {error ? <p className="text-xs text-[var(--status-danger)]">{error}</p> : null}

        {pending.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-secondary)]">
              Waiting on you ({pending.length})
            </h3>
            <ul className="flex flex-col gap-2">
              {pending.map((booking) => (
                <li
                  key={booking.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--gold-400)]/30 bg-[var(--gold-400)]/5 px-3 py-3"
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
                      className="rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-[var(--gold-500)] disabled:opacity-50"
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
          </div>
        ) : null}

        {confirmed.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-secondary)]">
              Booked through your link
            </h3>
            <ul className="flex flex-col gap-2">
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
          </div>
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

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
