import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getActivity } from "@/lib/activity";
import { ActivityFeed } from "@/components/activity/ActivityFeed";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const entries = await getActivity(ctx.orgId);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Activity
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Across every hub
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          One timeline of everything Earn and the agent team have done — workflows
          planned and run, and the deliverables they produced — across Build,
          Source, Run, and Execute.
        </p>
      </header>

      <ActivityFeed entries={entries} />
    </div>
  );
}
