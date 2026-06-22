// components/workspace/WorkspaceDocumentListLive.tsx
// Server component: loads the org's workspace documents from Supabase and
// renders them through the presentational WorkspaceDocumentList. Best-effort —
// any failure (no auth, no org, query error) degrades to the empty state
// rather than throwing, so the Data Room surface always renders.
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { WorkspaceDocumentList } from "@/components/workspace/DocumentCard";
import type { DocType } from "@/lib/workspace";

interface WorkspaceDoc {
  id: string;
  title: string;
  docType: DocType;
  blocks: { id: string; type: "paragraph"; content: string }[];
  isPinned: boolean;
  updatedAt: string;
}

async function loadWorkspaceDocs(): Promise<WorkspaceDoc[]> {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return [];

    const supabase = createServerClient();
    const { data } = await supabase
      .from("documents")
      .select("id, name, doc_type, content, created_at")
      .eq("organization_id", auth.ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(50);

    return (data ?? []).map((d) => ({
      id: d.id,
      title: d.name ?? "Untitled",
      docType: (d.doc_type ?? "note") as DocType,
      blocks: d.content
        ? [{ id: d.id, type: "paragraph" as const, content: d.content }]
        : [],
      isPinned: false,
      updatedAt: d.created_at,
    }));
  } catch {
    return [];
  }
}

export async function WorkspaceDocumentListLive() {
  const docs = await loadWorkspaceDocs();
  return <WorkspaceDocumentList docs={docs} />;
}
