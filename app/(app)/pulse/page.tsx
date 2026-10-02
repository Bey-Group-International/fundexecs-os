import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { pulseSearchesLast24h } from "@/lib/pulse.server";
import { remainingSearches, PULSE_DAILY_SEARCH_CAP } from "@/lib/pulse";
import type { PulseItem, PulseRun } from "@/lib/supabase/database.types";
import PulseClient from "./PulseClient";

export const metadata: Metadata = {
  title: "Market Pulse · FundExecs OS",
  description: "Deals, investments, and investors that fit your mandate, found on the live web each day.",
};

export const dynamic = "force-dynamic";
// The Refresh server action runs one web-search-backed model call (up to the
// long-run client timeout plus a retry), so give this segment the full envelope.
export const maxDuration = 300;

// Market Pulse: Earn's daily, mandate-matched scan of the live web. The sweep
// (lib/pulse.server.ts, run from /api/cron) posts findings; members triage them
// here — add to the pipeline, ask Earn, or dismiss.
export default async function PulsePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");
  const orgId = ctx.orgId;

  const supabase = await createServerClient();
  const [fresh, added, lastRun, searchesToday] = await Promise.all([
    supabase
      .from("pulse_items")
      .select("*")
      .eq("organization_id", orgId)
      .eq("status", "new")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("pulse_items")
      .select("*")
      .eq("organization_id", orgId)
      .eq("status", "added")
      .order("acted_at", { ascending: false })
      .limit(20),
    supabase
      .from("pulse_runs")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    pulseSearchesLast24h(supabase, orgId),
  ]);

  return (
    <PulseClient
      items={(fresh.data ?? []) as PulseItem[]}
      added={(added.data ?? []) as PulseItem[]}
      lastRun={(lastRun.data as PulseRun | null) ?? null}
      searchesLeft={remainingSearches(searchesToday)}
      searchCap={PULSE_DAILY_SEARCH_CAP}
    />
  );
}
