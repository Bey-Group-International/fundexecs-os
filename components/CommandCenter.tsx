// components/CommandCenter.tsx
// The Command Center — the operator's mission control.
import { buildRelationshipScores, extractDecayAlerts } from "@/lib/relationship-score";
import { buildNBAList } from "@/lib/next-best-action";
import { buildInsights, IntelligenceStrip } from "@/components/IntelligenceStrip";
import { NextBestAction } from "@/components/NextBestAction";
import { createServerClient } from "@/lib/supabase/server";

export async function CommandCenter() {
  const supabase = createServerClient();

  const scores = await buildRelationshipScores(supabase);
  const decayAlerts = extractDecayAlerts(scores);
  const nbaItems = buildNBAList(decayAlerts, scores, { maxItems: 5 });

  const committedCount = scores.filter((s) => s.temperature === "committed").length;
  const warmCount = scores.filter((s) => s.temperature === "warm").length;

  const insights = buildInsights({
    decayAlerts,
    totalInvestors: scores.length,
    committedCount,
    warmCount,
  });

  return (
    <div className="flex flex-col gap-6">
      {insights.length > 0 && <IntelligenceStrip insights={insights} />}
      <section>
        <NextBestAction items={nbaItems} />
      </section>
    </div>
  );
}
