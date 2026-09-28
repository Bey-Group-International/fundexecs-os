"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { presenceByMeeting, type ParticipantRow, type RoomPresence } from "@/lib/meetings/attendance";

// Monotonic counter for realtime channel names. Every useLivePresence
// subscription gets a distinct channel so multiple consumers on the same page
// (e.g. the calendar grid and the Upcoming list) — and any re-subscription —
// never reuse an already-subscribed channel. Reusing one and then calling
// `.on()` throws "cannot add postgres_changes callbacks ... after subscribe()".
let presenceChannelSeq = 0;
export function nextPresenceChannelName(): string {
  presenceChannelSeq += 1;
  return `meetings-presence-${presenceChannelSeq}`;
}

// Same idea for the postgres_changes subscriptions in the meeting lists/calendar:
// the same list can be mounted twice at once (e.g. Upcoming on the landing AND
// inside the calendar overlay's rail). Give each mount a distinct channel name so
// they don't collide on a shared Supabase channel.
let listChannelSeq = 0;
export function nextChannelName(prefix: string): string {
  listChannelSeq += 1;
  return `${prefix}-${listChannelSeq}`;
}

/**
 * A ticking clock for live countdowns. Re-renders the consumer every
 * `intervalMs` with a fresh `Date.now()`.
 *
 * Stops while the tab is hidden, and reads the clock once on the way back.
 *
 * It used to tick unconditionally for the life of the tab, which is a render of
 * every Upcoming card and — once the calendar overlay has been opened — of the
 * whole month grid, once a second, forever, including for the hours a
 * background tab spends showing nobody anything. A countdown nobody can see does
 * not need to be right; it needs to be right the moment they look, which is what
 * the visibility change does.
 *
 * Browsers throttle background timers but do not stop them, so this is not
 * something the platform was already handling.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;

    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

    function start() {
      if (id !== null) return;
      id = setInterval(() => setNow(Date.now()), intervalMs);
    }

    function stop() {
      if (id === null) return;
      clearInterval(id);
      id = null;
    }

    function onVisibility() {
      if (hidden()) {
        stop();
        return;
      }
      // The clock is stale by however long the tab was away, so it is read
      // before the interval resumes rather than after the next tick — otherwise
      // the first thing somebody sees on returning is the countdown they left.
      setNow(Date.now());
      start();
    }

    if (!hidden()) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);

  return now;
}

export type { RoomPresence } from "@/lib/meetings/attendance";

export interface RecentJoin {
  name: string;
  meetingId: string;
  at: number;
}

/**
 * Live presence + join activity for a set of meetings, sourced from
 * live_meeting_participants (rows with no left_at = currently in the room).
 * Requires the org-read RLS policy on that table so a viewer can see co-members'
 * attendance; Supabase Realtime replays INSERT/UPDATE events under the same RLS,
 * which drives both the live head-count and the "just joined" feed.
 */
export function useLivePresence(meetingIds: string[]): {
  presence: Record<string, RoomPresence>;
  recentJoins: RecentJoin[];
} {
  const key = [...meetingIds].sort().join(",");
  const [presence, setPresence] = useState<Record<string, RoomPresence>>({});
  const [recentJoins, setRecentJoins] = useState<RecentJoin[]>([]);
  const idsRef = useRef<string[]>(meetingIds);
  idsRef.current = meetingIds;

  useEffect(() => {
    if (!key) {
      setPresence({});
      return;
    }
    const supabase = createClient();
    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    async function refresh() {
      const ids = idsRef.current;
      if (ids.length === 0) {
        setPresence({});
        return;
      }
      const { data } = await supabase
        .from("live_meeting_participants")
        .select("meeting_id, display_name, joined_at, left_at")
        .in("meeting_id", ids)
        .is("left_at", null);
      if (cancelled) return;
      // `left_at is null` is necessary but not sufficient: departure is a write,
      // and a killed tab never makes it. presenceByMeeting applies the
      // staleness ceiling that keeps a crashed browser from being counted as
      // sitting in the room indefinitely.
      setPresence(presenceByMeeting((data ?? []) as ParticipantRow[]));
    }

    function scheduleRefresh() {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 300);
    }

    void refresh();

    const channel = supabase
      .channel(nextPresenceChannelName())
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_meeting_participants" },
        (payload) => {
          const rec = (payload.new ?? payload.old) as
            | { meeting_id?: string; display_name?: string }
            | null;
          // The org-read RLS policy means this channel receives participant
          // events for every meeting in the org. Ignore anything outside the
          // meetings we're tracking so unrelated churn doesn't refetch presence.
          if (!rec?.meeting_id || !idsRef.current.includes(rec.meeting_id)) return;
          if (payload.eventType === "INSERT" && rec.display_name) {
            setRecentJoins((prev) =>
              [{ name: rec.display_name!, meetingId: rec.meeting_id!, at: Date.now() }, ...prev].slice(0, 12),
            );
          }
          scheduleRefresh();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      void supabase.removeChannel(channel);
    };
  }, [key]);

  return { presence, recentJoins };
}
