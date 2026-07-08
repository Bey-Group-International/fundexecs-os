import { notFound } from "next/navigation";
import { HUB_BY_KEY } from "@/lib/hubs";
import type { Hub } from "@/lib/supabase/database.types";
import { getSessionContext } from "@/lib/auth";
import { getBuildReadiness, type ModuleStatus } from "@/lib/build-readiness";
import { getRunConviction } from "@/lib/run-conviction";
import { getSourceMomentum } from "@/lib/source-readiness";
import { getExecutePerformance } from "@/lib/execute-performance";
import { ReadinessPanel } from "@/components/build/ReadinessPanel";
import { ReadinessAlert } from "@/components/build/ReadinessAlert";
import { RunCommandCenter } from "@/components/run/RunCommandCenter";
import { SourceMomentumPanel } from "@/components/source/SourceMomentumPanel";
import { ExecuteCommandCenter } from "@/components/execute/ExecuteCommandCenter";
import { HubTabs } from "./HubTabs";

const HUB_KEYS: Hub[] = ["build", "source", "run", "execute"];

// Every hub has its own page; its modules are switched seamlessly via the top
// module switcher this layout renders above the active module's content. The
// Build hub additionally gets a readiness panel that scores the foundation and
// drives users toward the next-best step.
export default async function HubLayout(
  props: {
    children: React.ReactNode;
    params: Promise<{ hub: string }>;
  }
) {
  const params = await props.params;

  const {
    children
  } = props;

  if (!HUB_KEYS.includes(params.hub as Hub)) notFound();
  const hub = HUB_BY_KEY[params.hub as Hub];

  let moduleStatuses: Record<string, ModuleStatus> | undefined;
  let momentumPanel = null;
  if (hub.key === "build") {
    const ctx = await getSessionContext();
    if (ctx?.orgId) {
      const readiness = await getBuildReadiness(ctx.orgId);
      moduleStatuses = readiness.statuses;
      momentumPanel = (
        <ReadinessAlert>
          <ReadinessPanel readiness={readiness} floating />
        </ReadinessAlert>
      );
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
      {hub.approvalGated && (
        <div className="mb-5 flex flex-wrap items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3.5">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 font-mono text-[11px] text-amber-400">
            ⚑
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-fg-primary">Approval-gated actions</p>
            <p className="mt-0.5 text-[12px] leading-5 text-fg-secondary">
              Every AI action in this hub that touches deal records, sends communications, or
              modifies diligence requires your explicit approval before executing. Review pending
              approvals in your{" "}
              <a href="/inbox" className="text-gold-400 underline-offset-2 hover:underline">
                Inbox
              </a>
              . To widen or restrict AI permissions, visit{" "}
              <a href="/settings#mandates" className="text-gold-400 underline-offset-2 hover:underline">
                AI Permissions
              </a>
              .
            </p>
          </div>
        </div>
      )}
      {momentumPanel}
      <HubTabs hubKey={hub.key} modules={hub.modules} statuses={moduleStatuses} />
      {children}
    </div>
  );
}
