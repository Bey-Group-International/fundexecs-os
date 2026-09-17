// Server component for Documents › Create.
//
// Reads only what the offer needs to be specific to this firm: the names of the
// documents already held, so the core-materials checklist can say what is there
// rather than presenting the same five gaps to everyone, and which sections are
// occupied, so the template gallery can mark the ground already covered.
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { groupTemplates, keyMaterialStatus, missingMaterialCount } from "@/lib/document-create";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { CreateWorkspace } from "./CreateWorkspace";

export async function CreateLive() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");

  const supabase = await createServerClient();
  const { data } = await supabase
    .from("documents")
    .select("name, doc_type")
    .eq("organization_id", ctx.orgId);

  const docs = (data ?? []) as Array<{ name: string; doc_type: string | null }>;
  const materials = keyMaterialStatus(docs.map((d) => d.name));

  return (
    <div>
      <ModuleHeader
        title="Create"
        blurb="Start a document from an institutional template, draft one from your firm data, or begin with a blank page. Everything you make lands in the Library as a draft — creating it shows it to nobody."
        module="documents"
      />
      <CreateWorkspace
        materials={materials}
        groups={groupTemplates()}
        missingCount={missingMaterialCount(materials)}
        usedTemplateSections={[...new Set(docs.map((d) => d.doc_type).filter((t): t is string => Boolean(t)))]}
      />
    </div>
  );
}
