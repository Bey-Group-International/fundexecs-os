import { notFound } from "next/navigation";
import { HUB_BY_KEY } from "@/lib/hubs";
import type { Hub } from "@/lib/supabase/database.types";
import { getSessionContext } from "@/lib/auth";
import { getBuildReadiness, type ModuleStatus } from "@/lib/build-readiness";
import { getRunConviction } from "@/lib/run-conviction";
import { getSourceMomentum } from "@/lib/source-readiness";
import { getExecutePerformance } from "@/lib/execute-performance";
import { ReadinessPanel } from "@/components/build/ReadinessPanel";
import { RunCommandCenter } from "@/components/run/RunCommandCenter";
import { SourceMomentumPanel } from "@/components/source/SourceMomentumPanel";
import { ExecuteCommandCenter } from "@/components/execute/ExecuteCommandCenter";
import { HubTabs } from "./HubTabs";

const HUB_KEYS: Hub[] = ["build", "source", "run", "execute"];

// Every hub has its own page; its modules are switched seamlessly via the top
// module switcher this layout renders above the active module's content. The
// Build hub additionally gets a readiness panel that scores the foundation and
// drives users toward the next-best step.
export default async function HubLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { hub: string };
}) {
  if (!HUB_KEYS.includes(params.hub as Hub)) notFound();
  const hub = HUB_BY_KEY[params.hub as Hub];

  let moduleStatuses: Record<string, ModuleStatus> | undefined;
  let momentumPanel = null;
  if (hub.key === "build") {
    const ctx = await getSessionContext();
    if (ctx?.orgId) {
      const readiness = await getBuildReadiness(ctx.orgId);
      moduleStatuses = readiness.statuses;
      momentumPanel = <ReadinessPanel readiness={readiness} />;
    }
  } else if (hub.key === "source") {
    const ctx = await getSessionContext();
    if (ctx?.orgId) {
      const momentum = await getSourceMomentum(ctx.orgId);
      momentumPanel = <SourceMomentumPanel momentum={momentum} />;
    }
  } else if (hub.key === "run") {
    const ctx = await getSessionContext();
    if (ctx?.orgId) {
      const conviction = await getRunConviction(ctx.orgId);
      momentumPanel = <RunCommandCenter conviction={conviction} />;
    }
  } else if (hub.key === "execute") {
    const ctx = await getSessionContext();
    if (ctx?.orgId) {
      const perf = await getExecutePerformance(ctx.orgId);
      momentumPanel = <ExecuteCommandCenter perf={perf} />;
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="h-5 w-1 rounded-full bg-gradient-to-b from-gold-300 to-gold-500"
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            {hub.label} Hub
          </span>
        </div>
        <p className="mt-2 max-w-prose text-[15px] leading-snug text-fg-secondary">
          {hub.purpose}
        </p>
      </header>
      {momentumPanel}
      <HubTabs hubKey={hub.key} modules={hub.modules} statuses={moduleStatuses} />
      {children}
    </div>
  );
}
