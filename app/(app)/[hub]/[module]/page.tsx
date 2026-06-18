import { ModuleView } from "@/components/ModuleView";

export const dynamic = "force-dynamic";

// Standalone module page. The hub layout provides the title + module switcher;
// this renders the module's view (shared with the in-session frame).
export default function ModulePage({ params }: { params: { hub: string; module: string } }) {
  return <ModuleView hub={params.hub} module={params.module} />;
}
