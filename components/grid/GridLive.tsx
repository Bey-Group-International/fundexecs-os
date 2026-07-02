"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Keeps the Execution Grid live: subscribes to the org's task changes and
// refreshes the server page as workflows are routed and progress. Mirrors the
// realtime idiom in Copilot — same client, channel, debounced refresh, and
// cleanup. Renders an unobtrusive "live" indicator dot.
export function GridLive({ orgId }: { orgId: string }) {
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 400);
    };
    const channel = supabase
      .channel(`org-${orgId}-grid`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tasks", filter: `organization_id=eq.${orgId}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tasks", filter: `organization_id=eq.${orgId}` },
        refresh,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  // router.refresh is stable in App Router — excluded to prevent channel re-subscription on navigation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-success" />
      Live
    </span>
  );
}
