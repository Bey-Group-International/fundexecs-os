"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * A ticking clock for live countdowns. Re-renders the consumer every
 * `intervalMs` with a fresh `Date.now()`. One shared interval per hook usage;
 * cheap enough at the Upcoming Meetings scale (a handful of cards).
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface RoomPresence {
  count: number;
  names: string[];
}

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
        .select("meeting_id, display_name, left_at")
        .in("meeting_id", ids)
        .is("left_at", null);
      if (cancelled) return;
      const map: Record<string, RoomPresence> = {};
      for (const row of (data ?? []) as Array<{ meeting_id: string; display_name: string }>) {
        const p = map[row.meeting_id] ?? (map[row.meeting_id] = { count: 0, names: [] });
        p.count += 1;
        if (p.names.length < 8) p.names.push(row.display_name);
      }
      setPresence(map);
    }

    function scheduleRefresh() {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 300);
    }

    void refresh();

    const channel = supabase
      .channel("meetings-presence-live")
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
