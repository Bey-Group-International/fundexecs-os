import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { CanvasLayout } from "@/lib/automation-canvas";
import WorkflowCanvas from "@/components/automations/WorkflowCanvas";

export const dynamic = "force-dynamic";

// Automation detail — the visual flow builder for a single automation. Loads
// the automation (org-scoped) and its saved canvas_json, then hosts the
// WorkflowCanvas editor, which persists back through /api/automations/[id]/canvas.
export default async function AutomationCanvasPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  // Fetch the name and the saved layout in a single org-scoped read.
  const { data: automation } = await supabase
    .from("automations")
    .select("id, name, canvas_json")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!automation) notFound();

  const layout = (automation.canvas_json as unknown as CanvasLayout | null) ?? undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/automations"
          className="font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-gold-400"
        >
          ← Automations
        </Link>
        <span className="text-fg-muted">/</span>
        <h1 className="text-sm font-medium text-fg-primary">{automation.name}</h1>
      </div>

      <WorkflowCanvas automationId={id} initialLayout={layout} />
    </div>
  );
}
