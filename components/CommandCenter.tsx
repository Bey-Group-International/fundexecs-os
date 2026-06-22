// components/CommandCenter.tsx
// The Command Center — the operator's mission control.
import { Suspense } from "react";
import { buildRelationshipScores, extractDecayAlerts } from "@/lib/relationship-score";
import { buildNBAList } from "@/lib/next-best-action";
import { buildInsights, IntelligenceStrip } from "@/components/IntelligenceStrip";
import { NextBestAction } from "@/components/NextBestAction";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { CommandCenterSkeleton } from "@/components/CommandCenterSkeleton";
import { CommandCenterError } from "@/components/CommandCenterError";

async function CommandCenterContent() {
  const supabase = createServerClient();
  const ctx = await getSessionContext();
  const organizationId = ctx?.orgId;

  if (!organizationId) {
    return null;
  }

  let scores: Awaited<ReturnType<typeof buildRelationshipScores>> = [];
  let nbaItems: ReturnType<typeof buildNBAList> = [];

  try {
    scores = await buildRelationshipScores(supabase, organizationId);
  } catch (err) {
    console.error("[CommandCenter] buildRelationshipScores failed:", err);
  }

  try {
    const decayAlerts = extractDecayAlerts(scores);
    nbaItems = buildNBAList(decayAlerts, scores, { maxItems: 5 });

    const committedCount = scores.filter((s) => s.temperature === "committed").length;
    const warmCount = scores.filter((s) => s.temperature === "warm").length;

    const insights = buildInsights({
      decayAlerts,
      totalInvestors: scores.length,
      committedCount,
      warmCount,
    });

    if (insights.length === 0 && nbaItems.length === 0) {
      return (
        <div className="text-fg-muted text-sm text-center py-8">
          No insights or actions at this time. Check back after syncing your relationships.
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-6">
        {insights.length > 0 && <IntelligenceStrip insights={insights} />}
        <section>
          <NextBestAction items={nbaItems} />
        </section>
      </div>
    );
  } catch (err) {
    console.error("[CommandCenter] failed to build insights/NBA:", err);
    return (
      <div className="text-fg-muted text-sm text-center py-8">
        No insights or actions at this time. Check back after syncing your relationships.
      </div>
    );
  }
}

export function CommandCenter() {
  return (
    <CommandCenterError>
      <Suspense fallback={<CommandCenterSkeleton />}>
        <CommandCenterContent />
      </Suspense>
    </CommandCenterError>
  );
}
