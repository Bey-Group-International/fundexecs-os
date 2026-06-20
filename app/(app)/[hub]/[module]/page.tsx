import { ModuleView } from "@/components/ModuleView";
import { SourceSearch } from "@/components/source/SourceSearch";
import { SourceTriage } from "@/components/source/SourceTriage";
import { RunSearch } from "@/components/run/RunSearch";
import { ExecuteSearch } from "@/components/execute/ExecuteSearch";
import { sourcingLive, sourcingEnrichmentEnabled } from "@/lib/source-ai";
import { copilotLive } from "@/lib/claude";

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
  if (params.hub === "run" && params.module === "search") {
    return <RunSearch live={copilotLive()} initialPrompt={initialPrompt} />;
  }
  if (params.hub === "execute" && params.module === "search") {
    return <ExecuteSearch live={copilotLive()} initialPrompt={initialPrompt} />;
  }
  return <ModuleView hub={params.hub} module={params.module} />;
}
