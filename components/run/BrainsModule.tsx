// components/run/BrainsModule.tsx
// Run › Evaluate — the knowledge-synthesis review queue. Earn drafts knowledge
// articles from new artifacts; an operator approves (optionally editing) or
// discards each before it publishes to the firm's knowledge base. Backed by the
// live /api/brains/synthesis routes (list + approve + discard).
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { SynthesisReviewPanel } from "@/components/brains/SynthesisReviewPanel";

export async function BrainsModule() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");

  return (
    <div>
      <ModuleHeader
        title="Evaluate"
        blurb="Review and approve knowledge syntheses before they publish to your firm's knowledge base — edit a draft in place, approve it, or discard it."
      />
      <SynthesisReviewPanel orgId={ctx.orgId} />
    </div>
  );
}
