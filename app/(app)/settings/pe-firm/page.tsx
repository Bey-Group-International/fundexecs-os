import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { ROOT_FILE_META } from "@/lib/pe/root-file-templates";
import { PeRootFilesEditor, type StoredFile } from "@/components/settings/PeRootFilesEditor";

export const dynamic = "force-dynamic";

// The firm's PE settings — the root files the PE skills test deals against. With
// none set, every skill runs on labelled standing defaults.
export default async function PeFirmPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const { data } = await supabase.from("org_pe_root_files" as never).select("file_key, content, version, updated_at").eq("organization_id", ctx.orgId);
  const rows = ((data as Array<{ file_key: string; content: unknown; version: number | null; updated_at: string | null }> | null) ?? []).map(
    (r): StoredFile => ({ key: r.file_key, content: JSON.stringify(r.content ?? {}, null, 2), version: r.version ?? 1, updatedAt: r.updated_at }),
  );

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">PE department</span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">Your firm&apos;s settings</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
          The mandate, return hurdles, financing limits and KPI rules the PE skills test every deal against. Anything you leave
          unset runs on a labelled standing default, and the output says so. Editing the mandate un-signs it; only an owner or
          admin can approve it.
        </p>
      </header>
      <PeRootFilesEditor
        files={ROOT_FILE_META.map((m) => ({ key: m.key, title: m.title, blurb: m.blurb, starter: m.starter }))}
        stored={rows}
        canManage={ctx.role === "owner" || ctx.role === "admin"}
      />
    </div>
  );
}
