import { ModuleView } from "@/components/ModuleView";
import { SourceSearch } from "@/components/source/SourceSearch";
import { ExecuteSearch } from "@/components/execute/ExecuteSearch";
import { sourcingLive, sourcingEnrichmentEnabled } from "@/lib/source-ai";
import { copilotLive } from "@/lib/claude";

export const dynamic = "force-dynamic";

// Standalone module page. The hub layout provides the title + module switcher;
// this renders the module's view (shared with the in-session frame). The Source
// hub's "search" pseudo-module renders the conversational AI Sourcing search
// instead of a table.
export default function ModulePage({
  params,
  searchParams,
}: {
  params: { hub: string; module: string };
  searchParams?: { q?: string | string[] };
}) {
  if (params.hub === "source" && params.module === "search") {
    const q = Array.isArray(searchParams?.q) ? searchParams?.q[0] : searchParams?.q;
    return (
      <SourceSearch
        live={sourcingLive()}
        webEnrichment={sourcingEnrichmentEnabled()}
        initialPrompt={typeof q === "string" && q.trim() ? q : undefined}
      />
    );
  }
  if (params.hub === "execute" && params.module === "search") {
    const q = Array.isArray(searchParams?.q) ? searchParams?.q[0] : searchParams?.q;
    return (
      <ExecuteSearch
        live={copilotLive()}
        initialPrompt={typeof q === "string" && q.trim() ? q : undefined}
      />
    );
  }
  return <ModuleView hub={params.hub} module={params.module} />;
}
