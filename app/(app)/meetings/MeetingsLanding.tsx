"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import nextDynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { useBodyScrollLock, useFocusTrap } from "@/hooks/useFocusTrap";
import { MeetingLobby } from "./MeetingLobby";
import { UpcomingMeetingsList, type UpcomingMeeting } from "./UpcomingMeetingsList";
import { TranscriptAnalysisCard } from "@/app/(app)/meetings/TranscriptAnalysisCard";
import { SchedulingLinkCard } from "./SchedulingLinkCard";
import { CALENDAR_VIEW_PARAM, calendarViewUrl, parseCalendarView, type CalendarView } from "./calendar-view";
import type { PastMeeting } from "./PastMeetingsList";
import { MeetingLogs } from "./MeetingLogs";
import type { MeetingLogEntry } from "@/lib/meetings/meeting-log";
import type { CalendarMeeting } from "@/lib/meetings/calendar";

/**
 * Meetings landing. The landing shows the lobby (new meeting / join / calendar)
 * and the Upcoming meetings list; the full calendar opens as a full-screen
 * overlay. The overlay is portaled to <body> so it escapes the app shell's
 * `animate-fade-up` transform (which would otherwise trap/collapse a
 * `fixed inset-0` overlay — the same issue the live-call overlay hit).
 *
 * The calendar is a destination, so it has an address: `?view=calendar`, with
 * `?view=settings` for blocked time and connected calendars behind the header
 * toggle. State is driven off the URL, and the door is a plain "Calendar"
 * button in the lobby rather than a menu item two clicks deep. "Schedule for
 * later" in the New meeting menu still opens the same overlay — same room, two
 * doors, one of which is now visible without opening a menu.
 */

// Both panes are heavy (the calendar grid alone is the largest component on the
// page) and neither renders until the overlay opens, so they're split out of
// the landing bundle and fetched on first open. `ssr: false` is fine — this is
// a client component and the overlay has no server-rendered content.
const MeetingsCalendar = nextDynamic(
  () => import("./MeetingsCalendar").then((m) => m.MeetingsCalendar),
  { ssr: false, loading: () => <PaneLoading label="Loading calendar…" /> },
);
const CalendarManager = nextDynamic(
  () => import("./CalendarManager").then((m) => m.CalendarManager),
  { ssr: false, loading: () => <PaneLoading label="Loading calendar settings…" /> },
);

export function MeetingsLanding({
  initialMeetings,
  initialUpcoming,
  initialPast,
  initialLogs,
  userId,
  orgId,
}: {
  initialMeetings: CalendarMeeting[];
  initialUpcoming: UpcomingMeeting[];
  initialPast: PastMeeting[];
  initialLogs: MeetingLogEntry[];
  userId: string;
  orgId: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = parseCalendarView(searchParams.get(CALENDAR_VIEW_PARAM));
  const calendarOpen = view !== null;
  const pane: CalendarView = view ?? "calendar";

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The overlay covers the page but does not remove it from the tab order, so
  // without a trap Tab walks out of the calendar and into the sidebar and
  // meeting rows behind it — invisible, still clickable, and impossible to
  // navigate back out of. The lock stops the page underneath scrolling with it.
  const overlayRef = useRef<HTMLDivElement>(null);
  useFocusTrap(overlayRef, calendarOpen && mounted);
  useBodyScrollLock(calendarOpen && mounted);

  // Upcoming is what you act on; Logs is what you look up. Local state rather
  // than a URL param: the calendar owns ?view=, and a second address for a
  // switch between two lists on the same page would make Back mean two things.
  const [tab, setTab] = useState<"upcoming" | "logs">("upcoming");

  // Whether *this* session pushed the overlay onto the history stack. Closing
  // then means stepping back, which leaves the stack clean; a member who
  // deep-linked straight into `?view=calendar` has nothing to step back to, so
  // closing rewrites the URL in place instead of throwing them off the site.
  const pushedRef = useRef(false);
  useEffect(() => {
    if (!calendarOpen) pushedRef.current = false;
  }, [calendarOpen]);

  // The settings pane is mounted lazily but never unmounted afterwards: swapping
  // back and forth would otherwise reset the calendar's view, anchor date and
  // layer toggles — the calendar would forget where you were every time you
  // blocked an hour.
  const [settingsSeen, setSettingsSeen] = useState(false);
  useEffect(() => {
    if (pane === "settings") setSettingsSeen(true);
  }, [pane]);

  // Shallow history updates — `window.history` rather than `router.push` so
  // opening the calendar doesn't re-run the page's server query for a state
  // change the client already has in hand.
  const setView = useCallback(
    (next: CalendarView | null, mode: "push" | "replace") => {
      const url = calendarViewUrl(pathname, searchParams.toString(), next);
      if (mode === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname, searchParams],
  );

  const openCalendar = useCallback(
    (which: CalendarView = "calendar") => {
      pushedRef.current = true;
      setView(which, "push");
    },
    [setView],
  );

  const closeCalendar = useCallback(() => {
    if (pushedRef.current) window.history.back();
    else setView(null, "replace");
  }, [setView]);

  // Settings is a panel inside the calendar, not a separate destination:
  // entering it pushes (so Back returns to the grid), leaving it replaces (so
  // Back from the grid still closes the overlay rather than re-opening
  // settings).
  const showSettings = useCallback(() => setView("settings", "push"), [setView]);
  const hideSettings = useCallback(() => setView("calendar", "replace"), [setView]);

  // Escape backs out of settings first, then closes the overlay — so it never
  // throws away the whole calendar when the member only meant to leave a panel.
  useEffect(() => {
    if (!calendarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pane === "settings") hideSettings();
      else closeCalendar();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [calendarOpen, pane, hideSettings, closeCalendar]);

  return (
    // One centred column for the whole page. Previously the lobby and the
    // Upcoming list each carried their own `max-w-3xl` while the scheduling
    // card, the tabs and the transcript card ran the full width of the shell —
    // so nothing lined up and the page was wider than it was readable. The
    // measure lives here now, once, and every child is `w-full` inside it.
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {/* The app's page-header vocabulary — mono eyebrow, display title, one
          line of lede — held at a compact scale. Meetings is a desk somebody
          opens every day, so the header identifies the page without taking a
          third of the first screen the way a 3xl hero would. */}
      <header>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">
          Operations
        </span>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-fg-primary">
          Meetings
        </h1>
        <p className="mt-1 max-w-prose text-sm text-fg-secondary">
          Start or join a room, keep the calendar, and hold the record of what each meeting decided.
        </p>
      </header>

      <MeetingLobby onOpenCalendar={() => openCalendar("calendar")} />
      {/* Booking link sits between "start a meeting" and "meetings you have":
          it's how meetings arrive when someone else picks the time. Collapsed to
          a single row — it no longer competes with the meetings themselves. */}
      <SchedulingLinkCard />

      <div>
        <div role="tablist" aria-label="Meetings" className="mb-3 flex items-center gap-1 border-b border-line">
          <TabButton id="upcoming" active={tab === "upcoming"} onSelect={setTab}>
            Upcoming
          </TabButton>
          <TabButton id="logs" active={tab === "logs"} onSelect={setTab} count={initialLogs.length}>
            Logs
          </TabButton>
        </div>

        {/* Both panes stay mounted: Logs holds a search box and an open row,
            and switching to Upcoming and back should not throw either away. */}
        <div id="panel-upcoming" role="tabpanel" aria-labelledby="tab-upcoming" hidden={tab !== "upcoming"}>
          <UpcomingMeetingsList initialMeetings={initialUpcoming} />
        </div>
        <div id="panel-logs" role="tabpanel" aria-labelledby="tab-logs" hidden={tab !== "logs"}>
          <MeetingLogs entries={initialLogs} />
        </div>
      </div>

      {/* Between meetings is where a transcript gets analysed — it was a tab in
          the in-call copilot, which is the one place nobody is pasting one. */}
      <TranscriptAnalysisCard />

      {calendarOpen && mounted
        ? createPortal(
            <div
              ref={overlayRef}
              role="dialog"
              aria-modal="true"
              aria-label={pane === "settings" ? "Calendar settings" : "Calendar"}
              // Focusable so the trap has somewhere to put focus on open that
              // isn't a control — a screen reader then announces the dialog
              // and its label rather than "Close, button".
              tabIndex={-1}
              className="fixed inset-0 z-50 flex flex-col bg-surface-0 focus:outline-none"
            >
              <header className="flex shrink-0 items-center justify-between border-b border-line bg-surface-1 px-4 py-3 sm:px-6">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-[var(--gold-300)]"><CalendarIcon /></span>
                  <h2 className="truncate font-display text-base font-semibold tracking-tight text-fg-primary">
                    {pane === "settings" ? "Calendar settings" : "Calendar"}
                  </h2>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (pane === "settings" ? hideSettings() : showSettings())}
                    aria-pressed={pane === "settings"}
                    className={`fx-btn flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                      pane === "settings"
                        ? "border-gold-400/50 bg-gold-400/10 text-[var(--gold-300)]"
                        : "border-line bg-surface-1 text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
                    }`}
                  >
                    <GearIcon />
                    <span className="hidden sm:inline">{pane === "settings" ? "Back to calendar" : "Settings"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={closeCalendar}
                    className="fx-btn flex items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-xs font-medium text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
                  >
                    <CloseIcon /> <span className="hidden sm:inline">Close</span>
                  </button>
                </div>
              </header>
              <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                <div className={pane === "calendar" ? "mx-auto w-full max-w-7xl" : "hidden"}>
                  <MeetingsCalendar
                    initialMeetings={initialMeetings}
                    initialUpcoming={initialUpcoming}
                    initialPast={initialPast}
                    userId={userId}
                    orgId={orgId}
                  />
                </div>
                {settingsSeen ? (
                  <div className={pane === "settings" ? "mx-auto w-full max-w-2xl" : "hidden"}>
                    <CalendarManager />
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function TabButton({
  id, active, onSelect, count, children,
}: {
  id: "upcoming" | "logs";
  active: boolean;
  onSelect: (id: "upcoming" | "logs") => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={active}
      aria-controls={`panel-${id}`}
      onClick={() => onSelect(id)}
      className={`fx-focus -mb-px flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
        active
          ? "border-gold-400 text-fg-primary"
          : "border-transparent text-fg-muted hover:text-fg-secondary"
      }`}
    >
      {children}
      {typeof count === "number" && count > 0 && (
        <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium tabular-nums tracking-normal text-fg-secondary">
          {count}
        </span>
      )}
    </button>
  );
}

function PaneLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-fg-muted">
      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      {label}
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
