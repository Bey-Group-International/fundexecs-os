import { notFound } from "next/navigation";
import { HUB_BY_KEY } from "@/lib/hubs";
import type { Hub } from "@/lib/supabase/database.types";
import { getSessionContext } from "@/lib/auth";
import {
  getBuildReadiness,
  combineStatuses,
  IDENTITY_MODULE_KEYS,
  type ModuleStatus,
} from "@/lib/build-readiness";
import { getRunConviction } from "@/lib/run-conviction";
import { getSourceMomentum } from "@/lib/source-readiness";
import { getExecutePerformance } from "@/lib/execute-performance";
import { ReadinessPanel } from "@/components/build/ReadinessPanel";
import { ReadinessAlert } from "@/components/build/ReadinessAlert";
import { RunCommandCenter } from "@/components/run/RunCommandCenter";
import { SourceMomentumPanel } from "@/components/source/SourceMomentumPanel";
import { ExecuteCommandCenter } from "@/components/execute/ExecuteCommandCenter";
import { FeatureLockBanner } from "@/components/FeatureLockBanner";
import { gatedFeatureForHub } from "@/lib/feature-access";
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
      // The "Firm Identity" tab (key: profile) unifies profile, thesis, brand,
      // and entity — its marker reflects all four combined. Other tabs keep
      // their own per-module status. (readiness.statuses stays per-module so
      // other consumers, e.g. the data-room meter, are unaffected.)
      moduleStatuses = {
        ...readiness.statuses,
        profile: combineStatuses(
          IDENTITY_MODULE_KEYS.map((k) => readiness.statuses[k]).filter(Boolean),
        ),
      };
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

  // The Build hub's Firm Identity page uses a two-column data-room layout, so
  // the Build hub gets a wider canvas; the other hubs keep the focused width.
  const containerWidth = hub.key === "build" ? "max-w-6xl" : "max-w-4xl";
  const gatedFeature = gatedFeatureForHub(hub.key);

  return (
    <div className={`mx-auto ${containerWidth}`}>
      <header className="mb-5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="h-5 w-1 rounded-full bg-gradient-to-b from-gold-300 to-gold-500"
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">
            {hub.label} Hub
          </span>
        </div>
      </header>
      {gatedFeature && <FeatureLockBanner feature={gatedFeature} />}
      {momentumPanel}
      <HubTabs hubKey={hub.key} modules={hub.modules} statuses={moduleStatuses} />
      {children}
    </div>
  );
}
