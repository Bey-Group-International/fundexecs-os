"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Keeps the Unified Inbox live: subscribes to the org's inbox_threads and
// inbox_messages changes and refreshes the server page as threads arrive, get
// triaged, or gain replies. Mirrors the realtime idiom in GridLive/Copilot —
// same client, channel, debounced refresh, and cleanup — so a newly ingested
// thread or an incoming message shows up without a manual reload.
export function InboxLive({ orgId }: { orgId: string }) {
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 400);
    };
    const channel = supabase
      .channel(`org-${orgId}-inbox`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inbox_threads", filter: `organization_id=eq.${orgId}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "inbox_messages", filter: `organization_id=eq.${orgId}` },
        refresh,
      )
      .subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      supabase.removeChannel(channel);
    };
  // router.refresh is stable in App Router — excluded to prevent channel re-subscription on navigation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  return null;
}
