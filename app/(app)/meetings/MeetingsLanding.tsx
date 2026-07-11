"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MeetingLobby } from "./MeetingLobby";
import { MeetingsCalendar } from "./MeetingsCalendar";
import { UpcomingMeetingsList, type UpcomingMeeting } from "./UpcomingMeetingsList";
import type { PastMeeting } from "./PastMeetingsList";
import type { CalendarMeeting } from "@/lib/meetings/calendar";

/**
 * Meetings landing. The calendar is no longer always on the page — the flow is
 * Meetings → "Schedule for later" → calendar. The landing shows the lobby (new
 * meeting / join) and the Upcoming meetings list; the full calendar opens as a
 * full-screen overlay. The overlay is portaled to <body> so it escapes the app
 * shell's `animate-fade-up` transform (which would otherwise trap/collapse a
 * `fixed inset-0` overlay — the same issue the live-call overlay hit).
 */
export function MeetingsLanding({
  initialMeetings,
  initialUpcoming,
  initialPast,
  userId,
  orgId,
}: {
  initialMeetings: CalendarMeeting[];
  initialUpcoming: UpcomingMeeting[];
  initialPast: PastMeeting[];
  userId: string;
  orgId: string;
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape closes the calendar overlay.
  useEffect(() => {
    if (!calendarOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCalendarOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [calendarOpen]);

  return (
    <div className="flex flex-col gap-8">
      <MeetingLobby onScheduleLater={() => setCalendarOpen(true)} />
      <UpcomingMeetingsList initialMeetings={initialUpcoming} />

      {calendarOpen && mounted
        ? createPortal(
            <div className="fixed inset-0 z-50 flex flex-col bg-[var(--surface-0)]">
              <header className="flex shrink-0 items-center justify-between border-b border-[var(--line)] bg-[var(--surface-1)] px-4 py-3 sm:px-6">
                <div className="flex items-center gap-2">
                  <span className="text-[var(--gold-400)]"><CalendarIcon /></span>
                  <h2 className="text-base font-semibold text-[var(--fg-primary)]">Schedule a meeting</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setCalendarOpen(false)}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
                >
                  <CloseIcon /> Close
                </button>
              </header>
              <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                <MeetingsCalendar
                  initialMeetings={initialMeetings}
                  initialUpcoming={initialUpcoming}
                  initialPast={initialPast}
                  userId={userId}
                  orgId={orgId}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
