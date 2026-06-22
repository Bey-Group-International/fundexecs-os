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
const SourcingIntel = nextDynamic(() =>
  import("@/components/source/SourcingIntel").then((m) => m.SourcingIntel),
);
const SourceSignals = nextDynamic(() =>
  import("@/components/source/SourceSignals").then((m) => m.SourceSignals),
);
const RunSearch = nextDynamic(() =>
  import("@/components/run/RunSearch").then((m) => m.RunSearch),
);
const ExecuteSearch = nextDynamic(() =>
  import("@/components/execute/ExecuteSearch").then((m) => m.ExecuteSearch),
);

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

  if (params.hub === "source" && params.module === "search") {
    return (
      <SourceSearch
        live={sourcingLive()}
        webEnrichment={sourcingEnrichmentEnabled()}
        initialPrompt={initialPrompt}
      />
    );
  }
  if (params.hub === "source" && params.module === "triage") {
    return <SourceTriage live={sourcingLive()} initialPrompt={initialPrompt} />;
  }
  if (params.hub === "source" && params.module === "intel") {
    return <SourcingIntel live={sourcingLive()} initialPrompt={initialPrompt} />;
  }
  if (params.hub === "source" && params.module === "signals") {
    return <SourceSignals live={sourcingLive()} initialPrompt={initialPrompt} />;
  }
  if (params.hub === "run" && params.module === "search") {
    return <RunSearch live={copilotLive()} initialPrompt={initialPrompt} />;
  }
  if (params.hub === "execute" && params.module === "search") {
    return <ExecuteSearch live={copilotLive()} initialPrompt={initialPrompt} />;
  }
  return <ModuleView hub={params.hub} module={params.module} />;
}
