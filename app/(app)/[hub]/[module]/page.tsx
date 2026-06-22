import nextDynamic from "next/dynamic";
import { ModuleView } from "@/components/ModuleView";
import { sourcingLive, sourcingEnrichmentEnabled } from "@/lib/source-ai";
import { copilotLive } from "@/lib/claude";

// Lazily loaded — each search/triage surface is heavy and hub-specific.
// next/dynamic splits them into separate chunks loaded only when the matching
// route is visited, rather than bundling all four on every module page.
const SourceSearch = nextDynamic(() =>
  import("@/components/source/SourceSearch").then((m) => m.SourceSearch),
);
const SourceTriage = nextDynamic(() =>
  import("@/components/source/SourceTriage").then((m) => m.SourceTriage),
);
const OwnershipIntel = nextDynamic(() =>
  import("@/components/source/OwnershipIntel").then((m) => m.OwnershipIntel),
);
const SourcingIntel = nextDynamic(() =>
  import("@/components/source/SourcingIntel").then((m) => m.SourcingIntel),
);
const OutreachStudio = nextDynamic(() =>
  import("@/components/source/OutreachStudio").then((m) => m.OutreachStudio),
);
const SourceSignals = nextDynamic(() =>
  import("@/components/source/SourceSignals").then((m) => m.SourceSignals),
);
const SourceRadar = nextDynamic(() =>
  import("@/components/source/SourceRadar").then((m) => m.SourceRadar),
);
const SourceFunnel = nextDynamic(() =>
  import("@/components/source/SourceFunnel").then((m) => m.SourceFunnel),
);
const RadarAttribution = nextDynamic(() =>
  import("@/components/source/RadarAttribution").then((m) => m.RadarAttribution),
);
const CronHealth = nextDynamic(() =>
  import("@/components/ops/CronHealth").then((m) => m.CronHealth),
);
const RunSearch = nextDynamic(() =>
  import("@/components/run/RunSearch").then((m) => m.RunSearch),
);
const ExecuteSearch = nextDynamic(() =>
  import("@/components/execute/ExecuteSearch").then((m) => m.ExecuteSearch),
);

// Hub-specific feature components (lazy-loaded for code splitting).
const AllocatorDirectoryLive = nextDynamic(() =>
  import("@/components/source/AllocatorDirectoryLive").then((m) => m.AllocatorDirectoryLive),
);
const ClosingLive = nextDynamic(() =>
  import("@/components/execute/ClosingLive").then((m) => m.ClosingLive),
);
const PortfolioHealthDashboard = nextDynamic(() =>
  import("@/components/execute/PortfolioHealthDashboard").then(
    (m) => m.PortfolioHealthDashboard,
  ),
);
const ThesisLive = nextDynamic(() =>
  import("@/components/intelligence/ThesisLive").then((m) => m.ThesisLive),
);
const WorkspaceDocumentListLive = nextDynamic(() =>
  import("@/components/workspace/WorkspaceDocumentListLive").then((m) => m.WorkspaceDocumentListLive),
);

// The `source` hub's standalone modules: a registry of module key → render fn.
// Each shares the same shape (a sourcing-live surface keyed off ?q), so they live
// in one map instead of a long if-ladder — adding a module is a one-line entry.
// (Bespoke source modules like `lp_pipeline` are handled separately below.)
const SOURCE_MODULES: Record<string, (initialPrompt?: string) => JSX.Element> = {
  search: (initialPrompt) => (
    <SourceSearch
      live={sourcingLive()}
      webEnrichment={sourcingEnrichmentEnabled()}
      initialPrompt={initialPrompt}
    />
  ),
  triage: (initialPrompt) => <SourceTriage live={sourcingLive()} initialPrompt={initialPrompt} />,
  buyers: (initialPrompt) => <OwnershipIntel live={sourcingLive()} initialPrompt={initialPrompt} />,
  intel: (initialPrompt) => <SourcingIntel live={sourcingLive()} initialPrompt={initialPrompt} />,
  outreach: () => <OutreachStudio live={sourcingLive()} />,
  signals: (initialPrompt) => <SourceSignals live={sourcingLive()} initialPrompt={initialPrompt} />,
  radar: (initialPrompt) => <SourceRadar live={sourcingLive()} initialPrompt={initialPrompt} />,
  funnel: (initialPrompt) => <SourceFunnel live={sourcingLive()} initialPrompt={initialPrompt} />,
  attribution: (initialPrompt) => (
    <RadarAttribution live={sourcingLive()} initialPrompt={initialPrompt} />
  ),
  health: (initialPrompt) => <CronHealth live={sourcingLive()} initialPrompt={initialPrompt} />,
};

export const dynamic = "force-dynamic";

// Standalone module page. The hub layout provides the title + module switcher;
// this renders the module's view (shared with the in-session frame). A few hubs
// route a pseudo-module ("search" / "triage") to a conversational, Earn-driven
// surface instead of a table.
export default function ModulePage({
  params,
  searchParams,
}: {
  params: { hub: string; module: string };
  searchParams?: { q?: string | string[] };
}) {
  const q = Array.isArray(searchParams?.q) ? searchParams?.q[0] : searchParams?.q;
  const initialPrompt = typeof q === "string" && q.trim() ? q : undefined;

  if (params.hub === "source") {
    const renderSourceModule = SOURCE_MODULES[params.module];
    if (renderSourceModule) return renderSourceModule(initialPrompt);
  }
  if (params.hub === "run" && params.module === "search") {
    return <RunSearch live={copilotLive()} initialPrompt={initialPrompt} />;
  }
  if (params.hub === "execute" && params.module === "search") {
    return <ExecuteSearch live={copilotLive()} initialPrompt={initialPrompt} />;
  }

  // Source › LP Pipeline — Allocator Intelligence Directory.
  if (params.hub === "source" && params.module === "lp_pipeline") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        <AllocatorDirectoryLive />
        <div className="mt-8 border-t border-line pt-8">
          <ModuleView hub={params.hub} module={params.module} />
        </div>
      </div>
    );
  }

  // Execute › Closing — LP Onboarding + Contract Status Board.
  if (params.hub === "execute" && params.module === "closing") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 flex flex-col gap-8">
        <ClosingLive />
        <div className="border-t border-line pt-8">
          <ModuleView hub={params.hub} module={params.module} />
        </div>
      </div>
    );
  }

  // Execute › Asset Management — Portfolio Health Dashboard.
  // TODO: replace mock data with real portfolio metrics from Supabase.
  if (params.hub === "execute" && params.module === "asset_management") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        <section>
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
            Portfolio Health
          </p>
          <PortfolioHealthDashboard
            // TODO: fetch real healthScore, assets, riskAlerts, totalNAV from Supabase.
            healthScore={{ overall: 0, performance: 0, diversification: 0, momentum: 0, grade: "F", summary: "" }}
            assets={[]}
            riskAlerts={[]}
            totalNAV={0}
          />
        </section>
        <div className="mt-8 border-t border-line pt-8">
          <ModuleView hub={params.hub} module={params.module} />
        </div>
      </div>
    );
  }

  // Build › Data Room — Workspace Document List.
  if (params.hub === "build" && params.module === "data_room") {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <section>
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
            Knowledge Workspace
          </p>
          <WorkspaceDocumentListLive />
        </section>
        <div className="mt-8 border-t border-line pt-8">
          <ModuleView hub={params.hub} module={params.module} />
        </div>
      </div>
    );
  }

  // Build › Thesis — Deal Signal Feed + Sector Heatmap.
  // ThesisLive loads real signals + heatmap snapshots for the active org
  // (migration 0058), best-effort, and renders both sections.
  if (params.hub === "build" && params.module === "thesis") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 flex flex-col gap-8">
        <ThesisLive />
        <div className="border-t border-line pt-8">
          <ModuleView hub={params.hub} module={params.module} />
        </div>
      </div>
    );
  }

  return <ModuleView hub={params.hub} module={params.module} />;
}
