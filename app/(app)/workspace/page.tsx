import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { copilotLive } from "@/lib/claude";
import { getActiveIntegrations } from "@/lib/integrations/active";
import { orgConnectedChannels } from "@/lib/integrations/gateway";
import Copilot from "@/components/Copilot";
import { WorkspaceDocumentList } from "@/components/workspace/DocumentCard";
import type { DocType } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// The workspace hub: knowledge documents (Notion-style) pinned above the
// Earn copilot so operators can access memos and theses alongside the chat.
export default async function WorkspacePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();

  const [connected, docsRes] = await Promise.all([
    orgConnectedChannels(supabase, ctx.orgId),
    supabase
      .from("documents")
      .select("id, name, doc_type, content, created_at")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  // Map DB documents to WorkspaceDoc shape
  const workspaceDocs = (docsRes.data ?? []).map((d) => ({
    id: d.id,
    title: d.name ?? "Untitled",
    docType: (d.doc_type ?? "note") as DocType,
    blocks: d.content
      ? [{ id: d.id, type: "paragraph" as const, content: d.content }]
      : [],
    isPinned: false,
    updatedAt: d.created_at,
  }));

  return (
    <div className="fx-ambient mx-auto max-w-5xl">
      {workspaceDocs.length > 0 && (
        <section className="mb-10">
          <header className="mb-6">
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
              Workspace
            </span>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
              Documents
            </h1>
            <p className="mt-1 text-sm text-fg-secondary">
              IC memos, fund theses, and deal notes — your firm&apos;s knowledge base.
            </p>
          </header>
          <WorkspaceDocumentList docs={workspaceDocs} />
        </section>
      )}

      <Copilot
        orgId={ctx.orgId}
        live={copilotLive()}
        bundles={[]}
        integrations={getActiveIntegrations(connected)}
      />
    </div>
  );
}
