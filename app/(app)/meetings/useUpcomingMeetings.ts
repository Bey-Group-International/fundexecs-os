"use client";

// app/(app)/meetings/useUpcomingMeetings.ts
// The upcoming meetings, kept current, and everything that can be done to one.
//
// Split out of UpcomingMeetingsList so the landing's meetings workspace and the
// calendar's rail share one source of truth: the same realtime refresh, the same
// delete / reminder / sync calls, the same per-meeting outcome. Two copies of
// this would drift the first time either was fixed.
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { nextChannelName } from "./hooks";
import { fetchUpcoming, forgetUpcoming, recentUpcoming } from "./upcoming-cache";
import type { UpcomingMeeting } from "./UpcomingMeetingsList";

export type ReminderOutcome = { state: "sending" | "sent" | "failed"; message?: string };

export function useUpcomingMeetings(
  initialMeetings: UpcomingMeeting[],
  { reuseRecent = false }: { reuseRecent?: boolean } = {},
) {
  const [meetings, setMeetings] = useState(initialMeetings);
  // Per-meeting outcome of the reminder button, so one meeting's result never
  // appears under another.
  const [reminded, setReminded] = useState<Record<string, { state: "sending" | "sent" | "failed"; message?: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Distinct per mount so a second instance (e.g. inside the calendar overlay)
  // doesn't collide on a shared realtime channel.
  const [channelName] = useState(() => nextChannelName("upcoming-meetings"));

  async function refresh() {
    const data = await fetchUpcoming();
    if (data) setMeetings(data);
  }

  useEffect(() => {
    const supabase = createClient();
    const recent = reuseRecent ? recentUpcoming() : null;
    if (recent) setMeetings(recent);
    else void refresh();

    // Coalesce bursts of postgres changes into a single refetch so a save that
    // fires several row events doesn't trigger a refetch storm.
    function scheduleRefresh() {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(), 350);
    }

    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_meetings" }, () => {
        scheduleRefresh();
      })
      .subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
    // Mount-time only: reuseRecent describes the first render, and realtime
    // keeps the list current after it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName]);

  /**
   * Delete one meeting, or ("following") it and the rest of its series. The
   * series' later meetings are dropped from the list here too, so the list
   * does not show them until the realtime refresh catches up.
   */
  async function deleteMeeting(id: string, scope: "one" | "following" = "one") {
    setBusy(id);
    setError(null);
    const target = meetings.find((m) => m.id === id);
    const res = await fetch(`/api/meetings/${id}`, {
      method: "DELETE",
      ...(scope === "following"
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }) }
        : {}),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Failed to delete meeting");
    } else {
      setMeetings((prev) =>
        prev.filter(
          (m) =>
            m.id !== id &&
            !(
              scope === "following" &&
              target?.series_id &&
              m.series_id === target.series_id &&
              (m.series_index ?? -1) >= (target.series_index ?? 0)
            ),
        ),
      );
      // The shared answer still lists it; a copy mounting next must not.
      forgetUpcoming();
    }
    setBusy(null);
  }

  /**
   * Take a meeting off the host's connected calendar, leaving the meeting.
   *
   * The machinery has been in place since calendar sync shipped and nothing
   * could reach it: `decideWrite` returns a delete when a meeting's sync flag
   * is off, and nothing anywhere ever turned that flag off. The delete dialog
   * on this very screen says so out loud — "Connected calendar events are not
   * deleted unless separately approved and synced" — which was true and had no
   * way to act on it.
   *
   * Deliberately NOT part of Delete. A meeting that moved to another system, or
   * was put on the calendar by mistake, is still a meeting that happened.
   */
  async function removeFromCalendar(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/meetings/${id}/calendar`, { method: "DELETE" });
    if (!res.ok && res.status !== 202) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Couldn't remove that meeting from your calendar.");
    } else if (res.status === 202) {
      // The flag is written; the event comes off on the next sync. Said plainly
      // rather than shown as success, because the event is still there now.
      setError("Calendar sync is off for this meeting — the event will come off your calendar shortly.");
    }
    await refresh();
    setBusy(null);
  }

  async function retrySync(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/meetings/${id}/sync`, { method: "POST" });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "External calendar sync failed");
    }
    await refresh();
    setBusy(null);
  }

  /**
   * Email everyone on the meeting a reminder, now.
   *
   * The outcome is reported per meeting rather than in the shared error banner:
   * "sent to 3" is the answer to the question the host just asked, and a
   * refusal (too far out, nobody has an address, one just went out) is
   * information rather than a failure.
   */
  async function sendReminder(id: string) {
    setBusy(id);
    setError(null);
    setReminded((prev) => ({ ...prev, [id]: { state: "sending" } }));
    try {
      const res = await fetch(`/api/meetings/${id}/remind`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        sent?: number;
        total?: number;
        error?: string;
        warning?: string;
      };
      if (res.ok && (json.sent ?? 0) > 0) {
        const reach = `Reminder sent to ${json.sent}${json.total && json.total !== json.sent ? ` of ${json.total}` : ""}`;
        setReminded((prev) => ({
          ...prev,
          // A warning still means the emails went out, so it reads as sent —
          // but the host is told before they press the button a second time.
          [id]: { state: "sent", message: json.warning ? `${reach}. ${json.warning}` : reach },
        }));
      } else {
        setReminded((prev) => ({ ...prev, [id]: { state: "failed", message: json.error ?? "Could not send the reminder" } }));
      }
    } catch {
      setReminded((prev) => ({ ...prev, [id]: { state: "failed", message: "Could not reach the server" } }));
    } finally {
      // refresh() can reject on its own. Outside a finally that would leave
      // busy set forever, and this meeting's buttons disabled until the page is
      // reloaded — a failed refresh must not cost the host the row.
      try {
        await refresh();
      } finally {
        setBusy(null);
      }
    }
  }

  async function clearAll() {
    setBusy("__clear__");
    setError(null);
    const res = await fetch("/api/meetings/clear-all", { method: "POST" });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Failed to clear meetings");
    } else {
      setMeetings([]);
    }
    setBusy(null);
  }

  // Open the Earn dock with a clean, user-facing one-liner and run it. The rich
  // institutional context (deal financials, lead contacts, saved notes) is NOT
  // sent from here — only the meeting id + mode travel in `chatContext`, and the
  // server gathers and injects the sensitive context into the model call. Nothing
  // confidential is ever shown in the composer, persisted client-side, or exposed
  // over the network to the browser.
  function runWithEarn(prompt: string, chatContext: { id: string; mode: "prep" | "followup" }) {
    window.dispatchEvent(
      new CustomEvent("earn:open-with-context", { detail: { prompt, autoSend: true, chatContext } }),
    );
  }

  // "Prepare with Earn": Earn opens and streams a full institutional prep
  // briefing; the operator sees only this clean line as their message.
  function prepareWithEarn(meeting: UpcomingMeeting) {
    runWithEarn(`Prepare me for "${meeting.title}".`, { id: meeting.id, mode: "prep" });
  }

  // "Follow up": Earn opens and streams a full institutional follow-up (recap,
  // owners/dates, approval-sensitive language); the operator sees only this line.
  function followUpWithEarn(meeting: UpcomingMeeting) {
    runWithEarn(`Draft the follow-up for "${meeting.title}".`, { id: meeting.id, mode: "followup" });
  }


  return {
    meetings,
    setMeetings,
    reminded,
    busy,
    error,
    setError,
    refresh,
    deleteMeeting,
    removeFromCalendar,
    retrySync,
    sendReminder,
    clearAll,
    prepareWithEarn,
    followUpWithEarn,
  };
}
