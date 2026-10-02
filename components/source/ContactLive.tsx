"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Keeps a contact record live. The inbox ingest, the mailbox sweep and the
// meeting report all write onto network_activities for this contact; when one
// does, the server page re-reads the record so the timeline (and the report
// downloaded from it) reflect the conversation that just arrived. Same idiom as
// InboxLive: one channel, a debounced refresh, cleaned up on unmount. RLS
// applies to realtime, so a viewer only hears about rows they could read.
export function ContactLive({ contactId }: { contactId: string }) {
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      // Longer than the inbox's: one meeting writes a row per attendee, and a
      // burst of them should cost one refresh, not five.
      refreshTimer.current = setTimeout(() => router.refresh(), 800);
    };
    const channel = supabase
      .channel(`contact-${contactId}-timeline`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "network_activities", filter: `contact_id=eq.${contactId}` },
        refresh,
      )
      .subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      supabase.removeChannel(channel);
    };
    // router.refresh is stable in App Router — excluded to prevent re-subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  return null;
}
