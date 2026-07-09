import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { EarnPlanner } from "@/components/earn/EarnPlanner";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Plan with Earn",
  description:
    "Give Earn a directive and get a plan — delegate to the executive team or execute directly — with concrete next actions.",
};

// Build hub · Plan with Earn. The directive-planning skill (formerly the
// Command Center's Earn composer) lives here as a first-class Build module:
// describe what to move forward, and Earn decides delegate-vs-execute and lays
// out the play. Backed by /api/earn/plan.
export default async function BuildPlanPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return (
    <div className="py-2">
      <EarnPlanner
        placeholder="Give Earn a directive — e.g. open an anchor-LP raise for Fund III, or tighten the mandate thesis…"
        subheading="Describe what you want to move forward on the fund. Earn decides whether to delegate to the executive team or take it directly, and lays out the play."
      />
    </div>
  );
}
