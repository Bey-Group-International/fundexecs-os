"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MeetingLobby } from "./MeetingLobby";
import { MeetingsCalendar } from "./MeetingsCalendar";
import { UpcomingMeetingsList, type UpcomingMeeting } from "./UpcomingMeetingsList";
import { SchedulingLinkCard } from "./SchedulingLinkCard";
import { CalendarManager } from "./CalendarManager";
import type { PastMeeting } from "./PastMeetingsList";
import type { CalendarMeeting } from "@/lib/meetings/calendar";

/**
 * Meetings landing. The calendar is no longer always on the page — the flow is
 * Meetings → "Schedule for later" → calendar. The landing shows the lobby (new
 * meeting / join) and the Upcoming meetings list; the full calendar opens as a
 * full-screen overlay. The overlay is portaled to <body> so it escapes the app
 * shell's `animate-fade-up` transform (which would otherwise trap/collapse a
 * `fixed inset-0` overlay — the same issue the live-call overlay hit).
 *
 * One overlay, one door. "Schedule for later" in the lobby menu opens the
 * calendar; blocked time and connected calendars sit behind the Settings toggle
 * in its header. The scheduling card used to carry a second "Manage calendar"
 * button onto the same overlay — two names for one room — so it's gone.
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
  const [pane, setPane] = useState<"calendar" | "settings">("calendar");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function openCalendar(which: "calendar" | "settings" = "calendar") {
    setPane(which);
    setCalendarOpen(true);
  }

  // Escape backs out of settings first, then closes the overlay — so it never
  // throws away the whole calendar when the member only meant to leave a panel.
  useEffect(() => {
    if (!calendarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pane === "settings") setPane("calendar");
      else setCalendarOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [calendarOpen, pane]);

  return (
    <div className="flex flex-col gap-5">
      <MeetingLobby onScheduleLater={() => openCalendar("calendar")} />
      {/* Booking link sits between "start a meeting" and "meetings you have":
          it's how meetings arrive when someone else picks the time. Collapsed to
          a single row — it no longer competes with the meetings themselves. */}
      <SchedulingLinkCard />
      <UpcomingMeetingsList initialMeetings={initialUpcoming} />

      {calendarOpen && mounted
        ? createPortal(
            <div className="fixed inset-0 z-50 flex flex-col bg-[var(--surface-0)]">
              <header className="flex shrink-0 items-center justify-between border-b border-[var(--line)] bg-[var(--surface-1)] px-4 py-3 sm:px-6">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-[var(--gold-400)]"><CalendarIcon /></span>
                  <h2 className="truncate text-base font-semibold text-[var(--fg-primary)]">
                    {pane === "settings" ? "Calendar settings" : "Calendar"}
                  </h2>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPane(pane === "settings" ? "calendar" : "settings")}
                    aria-pressed={pane === "settings"}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      pane === "settings"
                        ? "border-[var(--gold-400)] bg-[var(--gold-400)]/10 text-[var(--gold-400)]"
                        : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                    }`}
                  >
                    <GearIcon />
                    <span className="hidden sm:inline">{pane === "settings" ? "Back to calendar" : "Settings"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarOpen(false)}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
                  >
                    <CloseIcon /> <span className="hidden sm:inline">Close</span>
                  </button>
                </div>
              </header>
              <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                {/* Both panes stay mounted. Swapping to settings and back would
                    otherwise reset the view, the anchor date and the layer
                    toggles — the calendar would forget where you were every
                    time you blocked an hour. */}
                <div className={pane === "calendar" ? "" : "hidden"}>
                  <MeetingsCalendar
                    initialMeetings={initialMeetings}
                    initialUpcoming={initialUpcoming}
                    initialPast={initialPast}
                    userId={userId}
                    orgId={orgId}
                  />
                </div>
                <div className={pane === "settings" ? "mx-auto w-full max-w-2xl" : "hidden"}>
                  <CalendarManager />
                </div>
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

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
